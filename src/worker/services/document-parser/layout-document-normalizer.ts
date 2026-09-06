import type {
  BoundingBox,
  LayoutCategory,
  LayoutDocument,
} from './document-parser.types.js';
import { layoutDocumentSchema } from './layout-document.schema.js';

type RawLayoutDocument = {
  schemaVersion: string;
  documentId: string;
  parseRunId: string;
  parser: {
    name: string;
    version: string;
    backend?: string;
    modelVersion?: string;
    configurationHash: string;
  };
  pages: Array<{
    pageNumber: number;
    width: number;
    height: number;
    elements: Array<{
      externalIndex?: number;
      level?: number | null;
      type: string;
      text?: string;
      normalizedText?: string;
      latex?: string;
      html?: string;
      bbox?: RawBoundingBox | null;
      assetIds?: string[];
      parserMetadata?: Record<string, unknown>;
      columnIndex?: number;
      confidence?: number;
      parentElementId?: string;
    }>;
  }>;
  assets: Array<{
    id: string;
    type: string;
    pageNumber: number;
    storagePath?: string;
    mimeType?: string;
    width?: number;
    height?: number;
    bbox?: RawBoundingBox | null;
    checksum?: string;
    metadata?: Record<string, unknown>;
  }>;
  warnings: string[];
};

type RawBoundingBox =
  | [number, number, number, number]
  | { x0?: unknown; y0?: unknown; x1?: unknown; y1?: unknown; l?: unknown; t?: unknown; r?: unknown; b?: unknown };

const LAYOUT_PAGE_SIZE = 1000;

export function normalizeLayoutDocument(value: unknown): LayoutDocument {
  const raw = rawLayoutDocumentSchema.parse(value);
  const pageOffset = raw.pages.some((page) => page.pageNumber === 0) ? 1 : 0;
  const normalized = {
    schemaVersion: 'layout-v1' as const,
    documentId: raw.documentId,
    parseRunId: raw.parseRunId,
    parser: {
      name: normalizeParserName(raw.parser.name),
      version: raw.parser.version,
      backend: raw.parser.backend,
      modelVersion: raw.parser.modelVersion,
      configurationHash: raw.parser.configurationHash,
    },
    pages: raw.pages.map((page, pageIndex) => normalizePage(raw, page, pageIndex, pageOffset)),
    assets: raw.assets.map((asset) => normalizeAsset(asset, pageOffset)),
    warnings: [...raw.warnings],
  };

  return layoutDocumentSchema.parse(normalized);
}

const rawLayoutDocumentSchema = {
  parse(value: unknown): RawLayoutDocument {
    if (!isRecord(value)) {
      throw new Error('LayoutDocument bruto não é um objeto.');
    }
    if (typeof value.schemaVersion !== 'string' || typeof value.documentId !== 'string' || typeof value.parseRunId !== 'string') {
      throw new Error('LayoutDocument bruto possui cabeçalho inválido.');
    }
    if (!isRecord(value.parser) || typeof value.parser.name !== 'string' || typeof value.parser.version !== 'string' || typeof value.parser.configurationHash !== 'string') {
      throw new Error('LayoutDocument bruto possui parser inválido.');
    }
    if (!Array.isArray(value.pages) || !Array.isArray(value.assets) || !Array.isArray(value.warnings)) {
      throw new Error('LayoutDocument bruto deve conter pages, assets e warnings como arrays.');
    }

    return value as RawLayoutDocument;
  },
};

function normalizePage(
  raw: RawLayoutDocument,
  page: RawLayoutDocument['pages'][number],
  pageIndex: number,
  pageOffset: number,
) {
  const normalizedPageNumber = page.pageNumber + pageOffset;
  return {
    pageNumber: normalizedPageNumber,
    width: LAYOUT_PAGE_SIZE,
    height: LAYOUT_PAGE_SIZE,
    elements: page.elements.map((element, elementIndex) => ({
      id: buildElementId(raw.documentId, normalizedPageNumber, element.externalIndex ?? elementIndex),
      externalId: element.externalIndex === undefined ? undefined : String(element.externalIndex),
      pageNumber: normalizedPageNumber,
      readingOrder: element.externalIndex ?? elementIndex,
      category: normalizeCategory(element.type),
      rawText: element.text,
      normalizedText: element.normalizedText ?? element.text,
      latex: element.latex,
      html: element.html,
      bbox: normalizeBoundingBox(element.bbox, page.width, page.height),
      columnIndex: element.columnIndex,
      confidence: element.confidence,
      parentElementId: element.parentElementId,
      assetIds: [...(element.assetIds ?? [])],
      parserMetadata: element.parserMetadata ? { ...element.parserMetadata } : undefined,
    })),
  };
}

function normalizeAsset(asset: RawLayoutDocument['assets'][number], pageOffset: number) {
  return {
    ...asset,
    pageNumber: asset.pageNumber + pageOffset,
    bbox: normalizeBoundingBox(asset.bbox, asset.width ?? 1, asset.height ?? 1),
  };
}

function normalizeBoundingBox(
  bbox: RawBoundingBox | null | undefined,
  width: number,
  height: number,
): BoundingBox {
  const coordinates = extractBoundingBoxCoordinates(bbox);
  if (!coordinates) {
    return zeroBoundingBox();
  }

  const [x0, y0, x1, y1] = coordinates;
  return {
    x0: normalizeCoordinate(x0, width),
    y0: normalizeCoordinate(y0, height),
    x1: normalizeCoordinate(x1, width),
    y1: normalizeCoordinate(y1, height),
    coordinateSpace: 'NORMALIZED_1000',
  };
}

function extractBoundingBoxCoordinates(bbox: RawBoundingBox | null | undefined): [number, number, number, number] | null {
  if (!bbox) return null;

  const coordinates = Array.isArray(bbox)
    ? bbox
    : [bbox.x0 ?? bbox.l, bbox.y0 ?? bbox.t, bbox.x1 ?? bbox.r, bbox.y1 ?? bbox.b];

  if (coordinates.length !== 4 || coordinates.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    return null;
  }

  const [x0, y0, x1, y1] = coordinates as [number, number, number, number];
  return x0 <= x1 && y0 <= y1 ? [x0, y0, x1, y1] : null;
}

function normalizeCoordinate(value: number, size: number) {
  if (!Number.isFinite(size) || size <= 0) return 0;
  const normalized = Math.round((value / size) * LAYOUT_PAGE_SIZE);
  return Math.max(0, Math.min(LAYOUT_PAGE_SIZE, normalized));
}

function zeroBoundingBox(): BoundingBox {
  return {
    x0: 0,
    y0: 0,
    x1: 0,
    y1: 0,
    coordinateSpace: 'NORMALIZED_1000',
  };
}

function normalizeCategory(value: string): LayoutCategory {
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  switch (normalized) {
    case 'TITLE':
    case 'TEXT':
    case 'LIST':
    case 'TABLE':
    case 'FIGURE':
    case 'FORMULA':
    case 'CAPTION':
    case 'HEADER':
    case 'FOOTER':
    case 'PAGE_NUMBER':
    case 'FOOTNOTE':
      return normalized;
    default:
      return 'UNKNOWN';
  }
}

function normalizeParserName(value: string) {
  const normalized = value.trim().toUpperCase();
  if (normalized === 'PDFJS' || normalized === 'MINERU' || normalized === 'PADDLE' || normalized === 'DOCLING') {
    return normalized;
  }
  return 'DOCLING';
}

function buildElementId(documentId: string, pageNumber: number, readingOrder: number) {
  return `${documentId}:${pageNumber}:${readingOrder}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
