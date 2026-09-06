import assert from 'node:assert/strict';
import test from 'node:test';

import { assertLayoutDocument, layoutDocumentSchema } from '../layout-document.schema.js';
import { normalizeLayoutDocument } from '../layout-document-normalizer.js';

test('normaliza a saída do parser para LayoutDocument neutro sem mutar o raw output', () => {
  const raw = {
    schemaVersion: 'docling-layout-v1',
    documentId: 'document-1',
    parseRunId: 'parse-run-1',
    parser: {
      name: 'DOCLING',
      version: '2.122.0',
      backend: 'pipeline',
      modelVersion: 'docling-layout-model-1',
      configurationHash: 'cfg-123',
    },
    pages: [
      {
        pageNumber: 0,
        width: 200,
        height: 100,
        elements: [
          {
            externalIndex: 0,
            level: 1,
            type: 'figure',
            text: 'Figura 1',
            normalizedText: 'Figura 1',
            latex: '\\frac{1}{2}',
            html: '<figure>Figura 1</figure>',
            bbox: [10, 20, 110, 80],
            assetIds: ['asset-1'],
            parserMetadata: { source: 'docling' },
          },
          {
            externalIndex: 1,
            level: null,
            type: 'conteudo_desconhecido',
            text: 'Linha simples',
            bbox: null,
            assetIds: [],
          },
        ],
      },
    ],
    assets: [
      {
        id: 'asset-1',
        type: 'FIGURE',
        pageNumber: 0,
        storagePath: 'document-1/parse-run-1/asset-1.png',
        mimeType: 'image/png',
        width: 200,
        height: 100,
        bbox: [10, 20, 110, 80],
        checksum: 'abc123',
        metadata: { origin: 'docling' },
      },
    ],
    warnings: ['missing_page_provenance'],
  };

  const snapshot = structuredClone(raw);
  const normalized = normalizeLayoutDocument(raw);

  assert.deepStrictEqual(raw, snapshot);
  assert.equal(normalized.schemaVersion, 'layout-v1');
  assert.equal(normalized.documentId, 'document-1');
  assert.equal(normalized.parseRunId, 'parse-run-1');
  assert.equal(normalized.parser.name, 'DOCLING');
  assert.equal(normalized.parser.version, '2.122.0');
  assert.equal(normalized.parser.backend, 'pipeline');
  assert.equal(normalized.parser.modelVersion, 'docling-layout-model-1');
  assert.equal(normalized.parser.configurationHash, 'cfg-123');
  const page = normalized.pages[0]!;
  const firstElement = page.elements[0]!;
  const secondElement = page.elements[1]!;
  const asset = normalized.assets[0]!;

  assert.equal(page.pageNumber, 1);
  assert.equal(page.width, 1000);
  assert.equal(page.height, 1000);
  assert.equal(firstElement.category, 'FIGURE');
  assert.equal(firstElement.rawText, 'Figura 1');
  assert.equal(firstElement.normalizedText, 'Figura 1');
  assert.equal(firstElement.latex, '\\frac{1}{2}');
  assert.equal(firstElement.html, '<figure>Figura 1</figure>');
  assert.deepStrictEqual(firstElement.assetIds, ['asset-1']);
  assert.deepStrictEqual(firstElement.bbox, {
    x0: 50,
    y0: 200,
    x1: 550,
    y1: 800,
    coordinateSpace: 'NORMALIZED_1000',
  });
  assert.equal(secondElement.category, 'UNKNOWN');
  assert.equal(secondElement.rawText, 'Linha simples');
  assert.equal(secondElement.normalizedText, 'Linha simples');
  assert.equal(secondElement.latex, undefined);
  assert.equal(secondElement.bbox.coordinateSpace, 'NORMALIZED_1000');
  assert.equal(asset.pageNumber, 1);
  assert.equal(asset.type, 'FIGURE');
  assert.deepStrictEqual(asset.bbox, {
    x0: 50,
    y0: 200,
    x1: 550,
    y1: 800,
    coordinateSpace: 'NORMALIZED_1000',
  });
  assert.deepStrictEqual(normalized.warnings, ['missing_page_provenance']);

  assertLayoutDocument(normalized);
  assert.deepStrictEqual(layoutDocumentSchema.parse(normalized), normalized);
});

test('rejeita bbox inválida e asset referenciado ausente', () => {
  const base = normalizeLayoutDocument({
    schemaVersion: 'docling-layout-v1',
    documentId: 'document-1',
    parseRunId: 'parse-run-1',
    parser: {
      name: 'DOCLING',
      version: '2.122.0',
      configurationHash: 'cfg-123',
    },
    pages: [
      {
        pageNumber: 1,
        width: 100,
        height: 100,
        elements: [
          {
            externalIndex: 0,
            level: 0,
            type: 'TEXT',
            text: 'Questão 1',
            bbox: [0, 0, 50, 20],
            assetIds: [],
          },
        ],
      },
    ],
    assets: [],
    warnings: [],
  });

  assert.throws(() => {
    const basePage = base.pages[0]!;
    const baseElement = basePage.elements[0]!;
    layoutDocumentSchema.parse({
      ...base,
      pages: [
        {
          ...basePage,
          elements: [
            {
              ...baseElement,
              bbox: {
                x0: 10,
                y0: 20,
                x1: 5,
                y1: 30,
                coordinateSpace: 'NORMALIZED_1000',
              },
            },
          ],
        },
      ],
    });
  }, /bbox/i);

  assert.throws(() => {
    const basePage = base.pages[0]!;
    const baseElement = basePage.elements[0]!;
    layoutDocumentSchema.parse({
      ...base,
      pages: [
        {
          ...basePage,
          elements: [
            {
              ...baseElement,
              assetIds: ['missing-asset'],
            },
          ],
        },
      ],
    });
  }, /asset/i);
});

test('aceita os formatos de bbox emitidos pelo Docling', () => {
  const normalized = normalizeLayoutDocument({
    schemaVersion: 'docling-layout-v1',
    documentId: 'document-docling-bbox',
    parseRunId: 'parse-run-1',
    parser: { name: 'DOCLING', version: '2.122.0', configurationHash: 'cfg-123' },
    pages: [{
      pageNumber: 1,
      width: 200,
      height: 100,
      elements: [
        { type: 'TEXT', text: 'LTRB', bbox: { l: 10, t: 20, r: 110, b: 80 }, assetIds: [] },
        { type: 'TEXT', text: 'XY', bbox: { x0: 20, y0: 10, x1: 120, y1: 60 }, assetIds: [] },
      ],
    }],
    assets: [],
    warnings: [],
  });

  assert.deepStrictEqual(normalized.pages[0]?.elements.map((element) => element.bbox), [
    { x0: 50, y0: 200, x1: 550, y1: 800, coordinateSpace: 'NORMALIZED_1000' },
    { x0: 100, y0: 100, x1: 600, y1: 600, coordinateSpace: 'NORMALIZED_1000' },
  ]);
});

test('limita coordenadas fora da pagina ao intervalo normalizado', () => {
  const normalized = normalizeLayoutDocument({
    schemaVersion: 'docling-layout-v1',
    documentId: 'document-clamped-bbox',
    parseRunId: 'parse-run-1',
    parser: { name: 'DOCLING', version: '2.122.0', configurationHash: 'cfg-123' },
    pages: [{
      pageNumber: 1,
      width: 200,
      height: 100,
      elements: [{ type: 'TEXT', text: 'fora da pagina', bbox: [-10, -20, 250, 140], assetIds: [] }],
    }],
    assets: [],
    warnings: [],
  });

  assert.deepStrictEqual(normalized.pages[0]?.elements[0]?.bbox, {
    x0: 0, y0: 0, x1: 1000, y1: 1000, coordinateSpace: 'NORMALIZED_1000',
  });
});

test('degrada somente o elemento com bbox inválida e preserva o restante do layout', () => {
  const normalized = normalizeLayoutDocument({
    schemaVersion: 'docling-layout-v1',
    documentId: 'document-invalid-bbox',
    parseRunId: 'parse-run-1',
    parser: { name: 'DOCLING', version: '2.122.0', configurationHash: 'cfg-123' },
    pages: [{
      pageNumber: 1,
      width: 200,
      height: 100,
      elements: [
        { type: 'TEXT', text: 'válido', bbox: [10, 20, 110, 80], assetIds: [] },
        { type: 'TEXT', text: 'inválido', bbox: { l: 110, t: 80, r: 10, b: 20 }, assetIds: [] },
      ],
    }],
    assets: [],
    warnings: [],
  });

  assert.equal(normalized.pages[0]?.elements.length, 2);
  assert.equal(normalized.pages[0]?.elements[0]?.rawText, 'válido');
  assert.deepStrictEqual(normalized.pages[0]?.elements[0]?.bbox, {
    x0: 50, y0: 200, x1: 550, y1: 800, coordinateSpace: 'NORMALIZED_1000',
  });
  assert.deepStrictEqual(normalized.pages[0]?.elements[1]?.bbox, {
    x0: 0, y0: 0, x1: 0, y1: 0, coordinateSpace: 'NORMALIZED_1000',
  });
});
