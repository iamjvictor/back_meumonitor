export type DocumentParserName = 'PDFJS' | 'MINERU' | 'PADDLE' | 'DOCLING';

export type LayoutCategory =
  | 'TITLE'
  | 'TEXT'
  | 'LIST'
  | 'TABLE'
  | 'FIGURE'
  | 'FORMULA'
  | 'CAPTION'
  | 'HEADER'
  | 'FOOTER'
  | 'PAGE_NUMBER'
  | 'FOOTNOTE'
  | 'UNKNOWN';

export type BoundingBox = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  coordinateSpace: 'NORMALIZED_1000' | 'PIXELS' | 'PDF_POINTS';
};

export type VisualAsset = {
  id: string;
  type: 'FIGURE' | 'TABLE' | 'FORMULA' | 'CROP' | 'LAYOUT_DEBUG';
  pageNumber: number;
  storagePath?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  bbox?: BoundingBox;
  checksum?: string;
  metadata?: Record<string, unknown>;
};

export type LayoutElement = {
  id: string;
  externalId?: string;
  pageNumber: number;
  readingOrder: number;
  category: LayoutCategory;
  rawText?: string;
  normalizedText?: string;
  latex?: string;
  html?: string;
  bbox: BoundingBox;
  columnIndex?: number;
  confidence?: number;
  parentElementId?: string;
  assetIds: string[];
  parserMetadata?: Record<string, unknown>;
};

export type LayoutPage = {
  pageNumber: number;
  width: number;
  height: number;
  elements: LayoutElement[];
};

export type LayoutDocument = {
  schemaVersion: string;
  documentId: string;
  parseRunId: string;
  parser: {
    name: DocumentParserName;
    version: string;
    backend?: string;
    modelVersion?: string;
    configurationHash: string;
  };
  pages: LayoutPage[];
  assets: VisualAsset[];
  warnings: string[];
};

export type DocumentParseStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'NORMALIZING'
  | 'COMPLETED'
  | 'COMPLETED_WITH_WARNINGS'
  | 'FAILED'
  | 'FALLBACK_REQUIRED'
  | 'SUPERSEDED';

export type ParseInput = {
  documentId: string;
  fileUrl: string;
  fileBytes?: Uint8Array;
  fileName?: string;
  contentHash: string;
  originalName?: string;
  mimeType?: string;
  parser?: DocumentParserName;
  backend?: string;
  configurationHash: string;
  parserVersion?: string;
  modelVersion?: string;
  schemaVersion?: string;
};

export type ParseSubmission = {
  parseRunId: string;
  status: DocumentParseStatus;
  statusUrl?: string;
  resultUrl?: string;
  idempotencyKey: string;
  result?: LayoutDocument;
};

export type ParseStatus = {
  parseRunId: string;
  status: DocumentParseStatus;
  progress?: number;
  message?: string;
  errorCode?: string;
  errorMessage?: string;
};

export type ParseRunRecord = ParseSubmission & {
  documentId: string;
  contentHash: string;
  parser: DocumentParserName;
  parserBackend?: string;
  parserVersion?: string;
  modelVersion?: string;
  layoutSchemaVersion?: string;
  configurationHash: string;
  createdAt: string;
  updatedAt: string;
  errorCode?: string;
  errorMessage?: string;
};

export type ParseRunStore = {
  findByIdempotencyKey(key: string): Promise<ParseRunRecord | null>;
  findById(parseRunId: string): Promise<ParseRunRecord | null>;
  save(record: ParseRunRecord): Promise<void>;
  update(parseRunId: string, patch: Partial<ParseRunRecord>): Promise<ParseRunRecord>;
};
