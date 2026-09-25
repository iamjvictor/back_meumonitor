import { createHash } from 'node:crypto';
import { buildIdempotencyKey } from './mineru-parser.adapter.js';
import { DocumentParserAdapterError, type DocumentParserAdapter } from './document-parser.adapter.js';
import type {
  ParseInput,
  ParseRunRecord,
  ParseRunStore,
  ParseStatus,
  ParseSubmission,
} from './document-parser.types.js';

export type DocumentParseOrchestratorOptions = {
  now?: () => Date;
  maxAttempts?: number;
  parseTimeoutMs?: number;
  featureEnabled?: boolean;
  logger?: BoundaryLogger;
};

type BoundaryLogger = (event: string, payload: Record<string, unknown>) => void;

/**
 * Starts and observes parser runs without knowing how runs are persisted.
 * Phase 3 can replace the injected store with a Prisma implementation.
 */
export class DocumentParseOrchestratorService {
  private readonly now: () => Date;
  private readonly maxAttempts: number;
  private readonly parseTimeoutMs?: number;
  private readonly featureEnabled: boolean;
  private readonly logger: BoundaryLogger;

  constructor(
    private readonly adapter: DocumentParserAdapter,
    private readonly store: ParseRunStore,
    options: DocumentParseOrchestratorOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 1);
    this.parseTimeoutMs = options.parseTimeoutMs;
    this.featureEnabled = options.featureEnabled ?? true;
    this.logger = options.logger ?? defaultBoundaryLogger;
  }

  async start(input: ParseInput): Promise<ParseRunRecord> {
    const idempotencyKey = buildIdempotencyKey(input);
    this.logger('docling_orchestrator.parse_started', {
      documentId: input.documentId,
      parser: input.parser ?? this.adapter.name,
      idempotencyKey,
      maxAttempts: this.maxAttempts,
      timeoutMs: this.parseTimeoutMs,
    });
    if (!this.featureEnabled) {
      const timestamp = this.now().toISOString();
      const fallback = buildFallbackRecord(input, idempotencyKey, timestamp);
      this.logger('docling_orchestrator.parse_fallback_required', {
        documentId: input.documentId,
        idempotencyKey,
        errorCode: fallback.errorCode,
        errorMessage: fallback.errorMessage,
        failureKind: classifyFailureKind(fallback.errorCode),
        reason: 'feature_disabled',
      });
      await this.store.save(fallback);
      return fallback;
    }
    const existing = await this.store.findByIdempotencyKey(idempotencyKey);
    if (existing && existing.status !== 'FAILED' && existing.status !== 'FALLBACK_REQUIRED') {
      return existing;
    }

    let submission: ParseSubmission | undefined;
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      this.logger('docling_orchestrator.parse_attempt_started', {
        documentId: input.documentId,
        idempotencyKey,
        attempt,
      });
      try {
        submission = await withTimeout(
          this.adapter.parse(input),
          this.parseTimeoutMs,
        );
        this.logger('docling_orchestrator.parse_attempt_finished', {
          documentId: input.documentId,
          idempotencyKey,
          attempt,
          parseRunId: submission.parseRunId,
          status: submission.status,
        });
        if (submission.status !== 'FAILED') break;
      } catch (error) {
        lastError = error;
        const errorCode = error instanceof DocumentParserAdapterError ? error.code : 'PARSER_REQUEST_FAILED';
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger('docling_orchestrator.parse_attempt_failed', {
          documentId: input.documentId,
          idempotencyKey,
          attempt,
          errorCode,
          errorMessage,
          failureKind: classifyFailureKind(errorCode),
        });
        if (attempt === this.maxAttempts) {
          const timestamp = this.now().toISOString();
          const fallback = buildFallbackRecord(
            input,
            idempotencyKey,
            timestamp,
            lastError,
            error instanceof DocumentParserAdapterError ? error.code : 'PARSER_REQUEST_FAILED',
          );
          this.logger('docling_orchestrator.parse_fallback_required', {
            documentId: input.documentId,
            idempotencyKey,
            attempt,
            errorCode: fallback.errorCode,
            errorMessage: fallback.errorMessage,
            failureKind: classifyFailureKind(fallback.errorCode),
          });
          await this.store.save(fallback);
          return canonicalizeParseRun(fallback, (await this.store.findByIdempotencyKey(idempotencyKey))?.parseRunId);
        }
      }
    }
    if (!submission || submission.status === 'FAILED') {
      const timestamp = this.now().toISOString();
      const fallback = buildFallbackRecord(input, idempotencyKey, timestamp, undefined, 'PARSER_FAILED');
      this.logger('docling_orchestrator.parse_fallback_required', {
        documentId: input.documentId,
        idempotencyKey,
        errorCode: fallback.errorCode,
        errorMessage: fallback.errorMessage,
        failureKind: classifyFailureKind(fallback.errorCode),
      });
      await this.store.save(fallback);
      return canonicalizeParseRun(fallback, (await this.store.findByIdempotencyKey(idempotencyKey))?.parseRunId);
    }
    const timestamp = this.now().toISOString();
    const record: ParseRunRecord = {
      ...submission,
      idempotencyKey,
      documentId: input.documentId,
      contentHash: input.contentHash,
      parser: input.parser ?? this.adapter.name,
      configurationHash: input.configurationHash,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.logger('docling_orchestrator.parse_submitted', {
      documentId: input.documentId,
      idempotencyKey,
      parseRunId: record.parseRunId,
      status: record.status,
    });
    await this.store.save(record);
    return canonicalizeParseRun(record, (await this.store.findByIdempotencyKey(idempotencyKey))?.parseRunId);
  }

  async status(parseRunId: string): Promise<ParseStatus> {
    const run = await this.store.findById(parseRunId);
    const status = await this.adapter.getStatus(parseRunId, run?.statusUrl);
    await this.store.update(parseRunId, {
      status: status.status,
      updatedAt: this.now().toISOString(),
    });
    return status;
  }

  async result(parseRunId: string) {
    const run = await this.store.findById(parseRunId);
    if (run?.result) {
      await this.store.update(parseRunId, {
        status: run.result.warnings.length > 0 ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED',
        updatedAt: this.now().toISOString(),
      });
      return { ...run.result, parseRunId };
    }
    const layout = await this.adapter.getResult(parseRunId, run?.resultUrl);
    const canonicalLayout = { ...layout, parseRunId };
    await this.store.update(parseRunId, {
      status: canonicalLayout.warnings.length > 0 ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED',
      updatedAt: this.now().toISOString(),
    });
    return canonicalLayout;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs) return promise;

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new DocumentParserAdapterError('parse timeout', 'PARSER_TIMEOUT')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

const defaultBoundaryLogger: BoundaryLogger = (event, payload) => {
  console.log(event, payload);
};

function buildFallbackRecord(
  input: ParseInput,
  idempotencyKey: string,
  timestamp: string,
  error?: unknown,
  errorCode = 'PARSER_REQUEST_FAILED',
): ParseRunRecord {
  return {
    parseRunId: buildFallbackParseRunId(input.documentId, idempotencyKey),
    status: 'FALLBACK_REQUIRED',
    idempotencyKey,
    documentId: input.documentId,
    contentHash: input.contentHash,
    parser: input.parser ?? 'DOCLING',
    configurationHash: input.configurationHash,
    createdAt: timestamp,
    updatedAt: timestamp,
    errorCode: error ? errorCode : undefined,
    errorMessage: error instanceof Error ? error.message : error ? String(error) : undefined,
  };
}

function classifyFailureKind(errorCode?: string) {
  switch (errorCode) {
    case 'PARSER_TIMEOUT':
      return 'timeout';
    case 'PARSER_HTTP_ERROR':
      return 'http';
    case 'PARSER_NETWORK_ERROR':
      return 'network';
    default:
      return 'unknown';
  }
}

function buildFallbackParseRunId(documentId: string, idempotencyKey: string) {
  const hex = createHash('sha256').update(`fallback:${documentId}:${idempotencyKey}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0')}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

/** In-memory implementation used by contract tests and local spikes. */
export class MemoryParseRunStore implements ParseRunStore {
  private readonly records = new Map<string, ParseRunRecord>();

  async findByIdempotencyKey(key: string) {
    return [...this.records.values()].find((record) => record.idempotencyKey === key) ?? null;
  }

  async findById(parseRunId: string) {
    return this.records.get(parseRunId) ?? null;
  }

  async save(record: ParseRunRecord) {
    const existing = await this.findByIdempotencyKey(record.idempotencyKey);
    const parseRunId = existing?.parseRunId ?? record.parseRunId;
    const persisted = canonicalizeParseRun({
      ...record,
      createdAt: existing?.createdAt ?? record.createdAt,
    }, parseRunId);
    if (existing && existing.parseRunId !== parseRunId) {
      this.records.delete(existing.parseRunId);
    }
    this.records.set(parseRunId, persisted);
  }

  async update(parseRunId: string, patch: Partial<ParseRunRecord>) {
    const current = this.records.get(parseRunId);
    if (!current) throw new Error(`Parse run não encontrado: ${parseRunId}`);
    const updated = { ...current, ...patch };
    this.records.set(parseRunId, updated);
    return updated;
  }
}

function canonicalizeParseRun(record: ParseRunRecord, parseRunId?: string): ParseRunRecord {
  if (!parseRunId || parseRunId === record.parseRunId) return record;
  return {
    ...record,
    parseRunId,
    result: record.result ? { ...record.result, parseRunId } : undefined,
  };
}
