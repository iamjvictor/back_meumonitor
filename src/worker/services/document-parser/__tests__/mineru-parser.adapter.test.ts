import assert from 'node:assert/strict';
import test from 'node:test';

import { DocumentParserAdapterError } from '../document-parser.adapter.js';
import { MineruParserAdapter } from '../mineru-parser.adapter.js';

const requests: Array<{ url: string; method: string; bodyType: string; fileName?: string }> = [];

const fetchMock: typeof fetch = async (input, init) => {
  const url = String(input);
  const body = init?.body;
  requests.push({
    url,
    method: init?.method ?? 'GET',
    bodyType: body instanceof FormData ? 'FormData' : typeof body,
    fileName: body instanceof FormData
      ? (() => { const entry = body.get('file'); return entry instanceof File ? entry.name : ''; })()
      : undefined,
  });

  if (url.endsWith('/v1/parse')) {
    return new Response(JSON.stringify({
      parseRunId: 'parse-run-1',
      status: 'PROCESSING',
      statusUrl: 'http://parser.test/v1/parse/parse-run-1',
      resultUrl: 'http://parser.test/v1/parse/parse-run-1/result',
      idempotencyKey: 'document-1:hash-1:MINERU:pipeline:cfg-1',
    }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (url.endsWith('/result')) {
    return new Response(JSON.stringify({
      schemaVersion: 'docling-layout-v1',
      documentId: 'document-1',
      parseRunId: 'parse-run-1',
      parser: {
        name: 'DOCLING',
        version: '2.122.0',
        backend: 'pipeline',
        modelVersion: 'docling-layout-model-1',
        configurationHash: 'cfg-1',
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
              type: 'text',
              text: 'Regra de três',
              normalizedText: 'Regra de três',
              latex: '\\frac{a}{b}',
              bbox: [10, 20, 110, 80],
              assetIds: ['asset-1'],
              parserMetadata: { source: 'docling' },
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
        },
      ],
      warnings: [],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    parseRunId: 'parse-run-1',
    status: 'COMPLETED',
    progress: 100,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

test('adapter mantém contrato HTTP e normaliza a resposta Docling para LayoutDocument neutro', async () => {
  const adapter = new MineruParserAdapter({
    baseUrl: 'http://parser.test',
    fetchImpl: fetchMock,
  });

  const submission = await adapter.parse({
    documentId: 'document-1',
    fileUrl: 'https://storage.test/document-1.pdf',
    fileBytes: new Uint8Array([37, 80, 68, 70]),
    originalName: 'document-1.pdf',
    contentHash: 'hash-1',
    parser: 'MINERU',
    backend: 'pipeline',
    configurationHash: 'cfg-1',
  });

  assert.equal(submission.parseRunId, 'parse-run-1');
  assert.equal(submission.idempotencyKey, 'document-1:hash-1:MINERU:pipeline:cfg-1');

  const layout = await adapter.getResult(submission.parseRunId, submission.resultUrl);
  const page = layout.pages[0]!;
  const element = page.elements[0]!;
  const asset = layout.assets[0]!;

  assert.equal(layout.schemaVersion, 'layout-v1');
  assert.equal(layout.documentId, 'document-1');
  assert.equal(layout.parseRunId, 'parse-run-1');
  assert.equal(layout.parser.name, 'DOCLING');
  assert.equal(page.pageNumber, 1);
  assert.equal(element.category, 'TEXT');
  assert.equal(element.rawText, 'Regra de três');
  assert.equal(element.normalizedText, 'Regra de três');
  assert.equal(element.latex, '\\frac{a}{b}');
  assert.deepStrictEqual(element.assetIds, ['asset-1']);
  assert.equal(element.bbox.coordinateSpace, 'NORMALIZED_1000');
  assert.equal(asset.pageNumber, 1);
  assert.equal(asset.bbox?.coordinateSpace, 'NORMALIZED_1000');

  const submitRequest = requests[0]!;
  const resultRequest = requests[1]!;

  assert.equal(submitRequest.method, 'POST');
  assert.equal(submitRequest.bodyType, 'FormData');
  assert.equal(submitRequest.fileName, 'document-1.pdf');
  assert.equal(resultRequest.method, 'GET');
});

test('adapter aceita a resposta inline completed do Docling sem depender de GET /result', async () => {
  const requests: Array<{ url: string; method: string }> = [];

  const fetchMock: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      method: init?.method ?? 'GET',
    });

    if (url.endsWith('/v1/parse')) {
      return new Response(JSON.stringify({
        status: 'completed',
        inputSha256: 'sha-256-fixture',
        result: {
          markdown: '# Aula\n',
          document: { schema_name: 'DoclingDocument', name: 'aula' },
          layout: {
            schemaVersion: 'docling-layout-v1',
            pages: [
              {
                pageNumber: 1,
                elements: [
                  {
                    externalIndex: 0,
                    level: 1,
                    type: 'text',
                    text: '1. Quanto e 2 + 2?',
                    bbox: [10, 20, 110, 80],
                  },
                ],
              },
            ],
            warnings: [],
          },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const adapter = new MineruParserAdapter({
    baseUrl: 'http://parser.test',
    fetchImpl: fetchMock,
  });

  const submission = await adapter.parse({
    documentId: 'document-1',
    fileUrl: 'https://storage.test/document-1.pdf',
    fileBytes: new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 102, 105, 120, 116, 117, 114, 101, 10]),
    fileName: 'document-1.pdf',
    contentHash: 'hash-1',
    parser: 'DOCLING',
    backend: 'pipeline',
    configurationHash: 'cfg-1',
  }) as Awaited<ReturnType<MineruParserAdapter['parse']>> & {
    result?: {
      schemaVersion: string;
      documentId: string;
      parseRunId: string;
    };
  };

  assert.equal(submission.status, 'COMPLETED');
  assert.match(submission.parseRunId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(submission.result?.schemaVersion, 'layout-v1');
  assert.equal(submission.result?.documentId, 'document-1');
  assert.equal(submission.result?.parseRunId, submission.parseRunId);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, 'POST');
});

test('adapter expõe a causa retornada pelo Docling quando o submit falha em HTTP', async () => {
  const logs: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const adapter = new MineruParserAdapter({
    baseUrl: 'http://parser.test',
    logger: (event, payload) => {
      logs.push({ event, payload });
    },
    fetchImpl: async () => new Response(JSON.stringify({
      status: 'failed',
      error: {
        code: 'PARSER_ERROR',
        message: 'model unavailable',
      },
    }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    }),
  });

  await assert.rejects(
    () => adapter.parse({
      documentId: 'document-1',
      fileUrl: 'https://storage.test/document-1.pdf',
      fileBytes: new Uint8Array([37, 80, 68, 70]),
      originalName: 'document-1.pdf',
      contentHash: 'hash-1',
      parser: 'DOCLING',
      backend: 'pipeline',
      configurationHash: 'cfg-1',
    }),
    (error: unknown) => {
      assert.ok(error instanceof DocumentParserAdapterError);
      assert.equal(error.code, 'PARSER_HTTP_ERROR');
      assert.equal(error.statusCode, 500);
      assert.match(error.message, /PARSER_ERROR/);
      assert.match(error.message, /model unavailable/);
      return true;
    },
  );

  assert.deepStrictEqual(logs.map((entry) => entry.event), [
    'docling_client.request_started',
    'docling_client.request_failed',
  ]);
  assert.equal(logs[1]?.payload.failureKind, 'http');
  assert.equal(logs[1]?.payload.statusCode, 500);
  assert.equal(logs[1]?.payload.upstreamCode, 'PARSER_ERROR');
});

test('adapter registra falha de rede separadamente de timeout e HTTP', async () => {
  const logs: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const adapter = new MineruParserAdapter({
    baseUrl: 'http://parser.test',
    logger: (event, payload) => {
      logs.push({ event, payload });
    },
    fetchImpl: async () => {
      throw new Error('socket hang up');
    },
  });

  await assert.rejects(
    () => adapter.parse({
      documentId: 'document-1',
      fileUrl: 'https://storage.test/document-1.pdf',
      fileBytes: new Uint8Array([37, 80, 68, 70]),
      originalName: 'document-1.pdf',
      contentHash: 'hash-1',
      parser: 'DOCLING',
      backend: 'pipeline',
      configurationHash: 'cfg-1',
    }),
    (error: unknown) => {
      assert.ok(error instanceof DocumentParserAdapterError);
      assert.equal(error.code, 'PARSER_NETWORK_ERROR');
      assert.match(error.message, /socket hang up/);
      return true;
    },
  );

  assert.deepStrictEqual(logs.map((entry) => entry.event), [
    'docling_client.request_started',
    'docling_client.request_failed',
  ]);
  assert.equal(logs[1]?.payload.failureKind, 'network');
});
