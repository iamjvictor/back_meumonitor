import { env } from '../../../config/env.js';
import { supabaseAdmin } from '../../../lib/supabase.js';
import { PrismaDocumentParseRunStore, persistLayoutDocument, updateDocumentParseRun } from '../../../repositories/document-parser.repository.js';
import { DocumentParseOrchestratorService } from './document-parse-orchestrator.service.js';
import { MineruParserAdapter } from './mineru-parser.adapter.js';
import type { DocumentParserAdapter } from './document-parser.adapter.js';
import type { DocumentParserName, DocumentParseStatus, LayoutDocument, ParseRunStore } from './document-parser.types.js';

export type DocumentIngestionV3Input = {
  documentId: string;
  storagePath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  fileBytes?: Uint8Array;
  parserVersion?: string;
  modelVersion?: string;
  configurationHash: string;
  backend?: string;
  schemaVersion?: string;
};

export type DocumentIngestionV3Result = {
  enabled: boolean;
  status: DocumentParseStatus;
  parseRunId: string;
  layoutPersisted: boolean;
  fileUrl?: string;
  parserName: DocumentParserName;
  fallbackReason?: string;
  warnings?: string[];
};

export type DocumentIngestionV3Options = {
  parser: DocumentParserAdapter;
  parseRunStore: ParseRunStore;
  buildFileUrl: (input: Pick<DocumentIngestionV3Input, 'documentId' | 'storagePath' | 'originalName' | 'mimeType' | 'sizeBytes'>) => Promise<string>;
  createDocumentParseRun?: unknown;
  persistLayoutDocument?: typeof persistLayoutDocument;
  updateDocumentParseRun?: typeof updateDocumentParseRun;
  featureEnabled?: boolean;
  parseTimeoutMs?: number;
  maxAttempts?: number;
  now?: () => Date;
  parserName?: DocumentParserName;
};

export class DocumentIngestionV3Service {
  private readonly orchestrator: DocumentParseOrchestratorService;
  private readonly featureEnabled: boolean;
  private readonly persistLayout: typeof persistLayoutDocument;
  private readonly updateParseRun?: typeof updateDocumentParseRun;
  private readonly parserName: DocumentParserName;

  constructor(private readonly options: DocumentIngestionV3Options) {
    this.orchestrator = new DocumentParseOrchestratorService(options.parser, options.parseRunStore, {
      featureEnabled: options.featureEnabled ?? true,
      parseTimeoutMs: options.parseTimeoutMs,
      maxAttempts: options.maxAttempts ?? 1,
      now: options.now,
    });
    this.featureEnabled = options.featureEnabled ?? true;
    this.persistLayout = options.persistLayoutDocument ?? persistLayoutDocument;
    this.updateParseRun = options.updateDocumentParseRun;
    this.parserName = options.parserName ?? 'DOCLING';
  }

  async processDocument(input: DocumentIngestionV3Input): Promise<DocumentIngestionV3Result> {
    if (!this.featureEnabled) {
      return {
        enabled: false,
        status: 'FALLBACK_REQUIRED',
        parseRunId: `fallback-${input.documentId}`,
        layoutPersisted: false,
        parserName: this.parserName,
        fallbackReason: 'document_ingestion_v3_disabled',
      };
    }

    const fileUrl = await this.options.buildFileUrl(input);
    const submission = await this.orchestrator.start({
      documentId: input.documentId,
      fileUrl,
      fileBytes: input.fileBytes,
      fileName: input.originalName,
      contentHash: input.contentHash,
      originalName: input.originalName,
      mimeType: input.mimeType,
      parser: this.parserName,
      backend: input.backend,
      configurationHash: input.configurationHash,
      parserVersion: input.parserVersion,
      modelVersion: input.modelVersion,
      schemaVersion: input.schemaVersion,
    });

    if (submission.status === 'FALLBACK_REQUIRED') {
      return {
        enabled: true,
        status: 'FALLBACK_REQUIRED',
        parseRunId: submission.parseRunId,
        layoutPersisted: false,
        fileUrl,
        parserName: this.parserName,
        fallbackReason: 'parser_fallback_required',
      };
    }

    const result: DocumentIngestionV3Result = {
      enabled: true,
      status: submission.status,
      parseRunId: submission.parseRunId,
      layoutPersisted: false,
      fileUrl,
      parserName: this.parserName,
    };

    if (submission.status === 'COMPLETED' || submission.status === 'COMPLETED_WITH_WARNINGS') {
      const layout = submission.result ?? await this.orchestrator.result(submission.parseRunId);
      await this.persistLayout({
        documentId: input.documentId,
        parseRunId: submission.parseRunId,
        layout,
      });
      if (this.updateParseRun) {
        await this.updateParseRun({
          parseRunId: submission.parseRunId,
          status: layout.warnings.length > 0 ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED',
          metrics: {
            pageCount: layout.pages.length,
            elementCount: layout.pages.reduce((total, page) => total + page.elements.length, 0),
            assetCount: layout.assets.length,
          },
        });
      }
      return {
        ...result,
        status: layout.warnings.length > 0 ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED',
        layoutPersisted: true,
        warnings: [...layout.warnings],
      };
    }

    if (this.updateParseRun) {
      await this.updateParseRun({
        parseRunId: submission.parseRunId,
        status: submission.status,
      });
    }

    return result;
  }
}

export function createDocumentIngestionV3Service(options: {
  parserBaseUrl?: string;
  featureEnabled?: boolean;
  parseTimeoutMs?: number;
  maxAttempts?: number;
}) {
  const featureEnabled = options.featureEnabled ?? env.DOCUMENT_INGESTION_V3_ENABLED;
  const parserBaseUrl = options.parserBaseUrl ?? env.DOCUMENT_PARSER_BASE_URL;
  if (featureEnabled && !parserBaseUrl) {
    throw new Error('DOCUMENT_PARSER_BASE_URL é obrigatório quando DOCUMENT_INGESTION_V3_ENABLED=true.');
  }
  const parser = new MineruParserAdapter({
    baseUrl: parserBaseUrl ?? 'http://127.0.0.1:3001',
    requestTimeoutMs: options.parseTimeoutMs ?? env.DOCUMENT_PARSER_REQUEST_TIMEOUT_MS,
  });

  return new DocumentIngestionV3Service({
    parser,
    parseRunStore: new PrismaDocumentParseRunStore(),
    buildFileUrl: async (input) => {
      const signed = await supabaseAdmin.storage.from('monitor-documents').createSignedUrl(input.storagePath, 60);
      if (signed.error || !signed.data?.signedUrl) {
        throw new Error(signed.error?.message || 'Nao foi possivel gerar URL assinada para o parser V3.');
      }
      return signed.data.signedUrl;
    },
    featureEnabled,
    parseTimeoutMs: options.parseTimeoutMs ?? env.DOCUMENT_PARSER_REQUEST_TIMEOUT_MS,
    maxAttempts: options.maxAttempts ?? env.DOCUMENT_PARSER_MAX_ATTEMPTS,
  });
}
