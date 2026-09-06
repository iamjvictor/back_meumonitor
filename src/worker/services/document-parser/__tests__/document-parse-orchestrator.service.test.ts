import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  ParseInput,
  LayoutDocument,
  ParseRunRecord,
  ParseStatus,
  ParseSubmission,
} from '../document-parser.types.js';
import type { DocumentParserAdapter } from '../document-parser.adapter.js';
import { DocumentParserAdapterError } from '../document-parser.adapter.js';
import {
  DocumentParseOrchestratorService,
  MemoryParseRunStore,
} from '../document-parse-orchestrator.service.js';

function makeInput(overrides: Partial<ParseInput & {
  parserVersion: string;
  modelVersion: string;
  schemaVersion: string;
}> = {}): ParseInput & {
  parserVersion: string;
  modelVersion: string;
  schemaVersion: string;
} {
  return {
    documentId: 'document-1',
    fileUrl: 'https://storage.test/document-1.pdf',
    contentHash: 'hash-1',
    parser: 'MINERU',
    backend: 'pipeline',
    configurationHash: 'cfg-1',
    parserVersion: '3.4.5',
    modelVersion: 'layout-model-1',
    schemaVersion: 'layout-v1',
    ...overrides,
  };
}

function makeCompletedRecord(input: ReturnType<typeof makeInput>): ParseRunRecord {
  return {
    parseRunId: 'parse-run-completed',
    status: 'COMPLETED',
    statusUrl: 'http://parser.test/v1/parse/parse-run-completed',
    resultUrl: 'http://parser.test/v1/parse/parse-run-completed/result',
    idempotencyKey: [
      input.contentHash,
      input.parser ?? 'MINERU',
      input.parserVersion,
      input.backend ?? 'pipeline',
      input.modelVersion,
      input.configurationHash,
      input.schemaVersion,
    ].join(':'),
    documentId: input.documentId,
    contentHash: input.contentHash,
    parser: input.parser ?? 'MINERU',
    parserVersion: input.parserVersion,
    configurationHash: input.configurationHash,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
  };
}

function makeAdapter(implementation: {
  parse?: (input: ParseInput) => Promise<ParseSubmission>;
  getStatus?: (parseRunId: string, statusUrl?: string) => Promise<ParseStatus>;
  getResult?: () => Promise<LayoutDocument>;
  name?: DocumentParserAdapter['name'];
}): DocumentParserAdapter {
  return {
    name: implementation.name ?? 'MINERU',
    parse: implementation.parse ?? (async () => ({
      parseRunId: 'parse-run-new',
      status: 'PROCESSING',
      statusUrl: 'http://parser.test/v1/parse/parse-run-new',
      resultUrl: 'http://parser.test/v1/parse/parse-run-new/result',
      idempotencyKey: 'fallback-key',
    })),
    getStatus: implementation.getStatus ?? (async (parseRunId) => ({
      parseRunId,
      status: 'COMPLETED',
    })),
    getResult: implementation.getResult ?? (async () => ({
      schemaVersion: 'layout-v1',
      documentId: 'document-1',
      parseRunId: 'parse-run-new',
      parser: {
        name: 'MINERU',
        version: '3.4.5',
        configurationHash: 'cfg-1',
      },
      pages: [],
      assets: [],
      warnings: [],
    })),
  };
}

test('não reutiliza COMPLETED quando parser metadata muda na chave de idempotência', async () => {
  let parseCalls = 0;
  const firstInput = makeInput();
  const secondInput = makeInput({ modelVersion: 'layout-model-2' });
  const store = new MemoryParseRunStore();
  await store.save(makeCompletedRecord(firstInput));

  const service = new DocumentParseOrchestratorService(
    makeAdapter({
      parse: async () => {
        parseCalls++;
        return {
          parseRunId: 'parse-run-new',
          status: 'PROCESSING',
          statusUrl: 'http://parser.test/v1/parse/parse-run-new',
          resultUrl: 'http://parser.test/v1/parse/parse-run-new/result',
          idempotencyKey: 'new-key',
        };
      },
    }),
    store,
    {
      now: () => new Date('2026-08-26T00:00:00.000Z'),
    },
  );

  const record = await service.start(secondInput);

  assert.equal(parseCalls, 1);
  assert.equal(record.parseRunId, 'parse-run-new');
  assert.equal(record.idempotencyKey, 'hash-1:MINERU:3.4.5:pipeline:layout-model-2:cfg-1:layout-v1');
});

test('fallback usa UUID persistível e preserva a causa original do parser', async () => {
  const store = new MemoryParseRunStore();
  const service = new DocumentParseOrchestratorService(
    makeAdapter({
      parse: async () => {
        throw new DocumentParserAdapterError('Falha de comunicação com o parser.', 'PARSER_NETWORK_ERROR');
      },
    }),
    store,
    { maxAttempts: 1 },
  );

  const record = await service.start(makeInput());

  assert.match(record.parseRunId, /^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(record.status, 'FALLBACK_REQUIRED');
  assert.equal(record.errorCode, 'PARSER_NETWORK_ERROR');
  assert.equal(record.errorMessage, 'Falha de comunicação com o parser.');
});

test('orchestrator registra fallback com causa distinta para timeout, HTTP e rede', async () => {
  const logs: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const store = new MemoryParseRunStore();
  const service = new DocumentParseOrchestratorService(
    makeAdapter({
      parse: async () => {
        throw new DocumentParserAdapterError(
          'Parser respondeu HTTP 502. upstreamCode=BAD_GATEWAY upstreamMessage=upstream down',
          'PARSER_HTTP_ERROR',
          502,
        );
      },
    }),
    store,
    {
      maxAttempts: 1,
      now: () => new Date('2026-08-26T00:00:00.000Z'),
      logger: (event, payload) => {
        logs.push({ event, payload });
      },
    },
  );

  const record = await service.start(makeInput());

  assert.equal(record.errorCode, 'PARSER_HTTP_ERROR');
  assert.deepStrictEqual(logs.map((entry) => entry.event), [
    'docling_orchestrator.parse_started',
    'docling_orchestrator.parse_attempt_started',
    'docling_orchestrator.parse_attempt_failed',
    'docling_orchestrator.parse_fallback_required',
  ]);
  assert.equal(logs[2]?.payload.errorCode, 'PARSER_HTTP_ERROR');
  assert.equal(logs[2]?.payload.failureKind, 'http');
  assert.equal(logs[3]?.payload.errorCode, 'PARSER_HTTP_ERROR');
  assert.equal(logs[3]?.payload.failureKind, 'http');
});

test('faz retry de falha transitória até o limite e conclui com a submissão bem-sucedida', async () => {
  let parseCalls = 0;
  const service = new DocumentParseOrchestratorService(
    makeAdapter({
      parse: async () => {
        parseCalls++;
        if (parseCalls < 3) {
          return {
            parseRunId: `parse-run-${parseCalls}`,
            status: 'FAILED',
            statusUrl: `http://parser.test/v1/parse/parse-run-${parseCalls}`,
            resultUrl: `http://parser.test/v1/parse/parse-run-${parseCalls}/result`,
            idempotencyKey: `attempt-${parseCalls}`,
          };
        }
        return {
          parseRunId: 'parse-run-final',
          status: 'PROCESSING',
          statusUrl: 'http://parser.test/v1/parse/parse-run-final',
          resultUrl: 'http://parser.test/v1/parse/parse-run-final/result',
          idempotencyKey: 'attempt-3',
        };
      },
    }),
    new MemoryParseRunStore(),
    {
      maxAttempts: 3,
      now: () => new Date('2026-08-26T00:00:00.000Z'),
    },
  );

  const record = await service.start(makeInput());

  assert.equal(parseCalls, 3);
  assert.equal(record.parseRunId, 'parse-run-final');
  assert.equal(record.status, 'PROCESSING');
});

test('retry da mesma idempotency key mantém o parseRunId canônico e alinha o layout', async () => {
  let parseCalls = 0;
  const store = new MemoryParseRunStore();
  const service = new DocumentParseOrchestratorService(
    makeAdapter({
      parse: async () => {
        parseCalls += 1;
        if (parseCalls === 1) {
          throw new DocumentParserAdapterError('timeout', 'PARSER_TIMEOUT');
        }
        return {
          parseRunId: 'parser-retry-id',
          status: 'COMPLETED',
          statusUrl: 'http://parser.test/v1/parse/parser-retry-id',
          resultUrl: 'http://parser.test/v1/parse/parser-retry-id/result',
          idempotencyKey: 'upstream-key',
          result: {
            schemaVersion: 'layout-v1',
            documentId: 'document-1',
            parseRunId: 'parser-retry-id',
            parser: { name: 'MINERU', version: '3.4.5', configurationHash: 'cfg-1' },
            pages: [], assets: [], warnings: [],
          },
        };
      },
    }),
    store,
    { maxAttempts: 1, now: () => new Date('2026-08-26T00:00:00.000Z') },
  );

  const fallback = await service.start(makeInput());
  const retry = await service.start(makeInput());

  assert.equal(fallback.status, 'FALLBACK_REQUIRED');
  assert.equal(retry.status, 'COMPLETED');
  assert.equal(retry.parseRunId, fallback.parseRunId);
  assert.equal(retry.result?.parseRunId, fallback.parseRunId);
  assert.equal((await store.findById(fallback.parseRunId))?.status, 'COMPLETED');
  assert.equal(await store.findById('parser-retry-id'), null);
});

test('idempotency keys diferentes criam parse runs independentes', async () => {
  let parseCalls = 0;
  const store = new MemoryParseRunStore();
  const service = new DocumentParseOrchestratorService(
    makeAdapter({
      parse: async () => ({
        parseRunId: `parser-id-${++parseCalls}`,
        status: 'PROCESSING',
        statusUrl: 'http://parser.test/status',
        resultUrl: 'http://parser.test/result',
        idempotencyKey: 'upstream-key',
      }),
    }),
    store,
    { now: () => new Date('2026-08-26T00:00:00.000Z') },
  );

  const first = await service.start(makeInput());
  const second = await service.start(makeInput({ modelVersion: 'layout-model-2' }));

  assert.notEqual(first.parseRunId, second.parseRunId);
  assert.equal((await store.findById(first.parseRunId))?.idempotencyKey, first.idempotencyKey);
  assert.equal((await store.findById(second.parseRunId))?.idempotencyKey, second.idempotencyKey);
});

test('timeout no documento termina em FALLBACK_REQUIRED sem loop infinito', async () => {
  let parseCalls = 0;
  const service = new DocumentParseOrchestratorService(
    makeAdapter({
      parse: async () => {
        parseCalls++;
        await new Promise(() => {});
        return {
          parseRunId: 'never',
          status: 'PROCESSING',
          statusUrl: 'http://parser.test/v1/parse/never',
          resultUrl: 'http://parser.test/v1/parse/never/result',
          idempotencyKey: 'never',
        };
      },
    }),
    new MemoryParseRunStore(),
    {
      maxAttempts: 1,
      parseTimeoutMs: 25,
      now: () => new Date('2026-08-26T00:00:00.000Z'),
    },
  );

  const record = await service.start(makeInput());

  assert.equal(parseCalls, 1);
  assert.equal(record.status, 'FALLBACK_REQUIRED');
  assert.equal(record.errorCode, 'PARSER_TIMEOUT');
  assert.equal(record.errorMessage, 'parse timeout');
});

test('fallback preserva o código do erro do adapter quando o Docling falha antes de responder', async () => {
  const store = new MemoryParseRunStore();
  const service = new DocumentParseOrchestratorService(
    makeAdapter({
      parse: async () => {
        throw new DocumentParserAdapterError(
          'Parser respondeu HTTP 500. upstreamCode=PARSER_ERROR upstreamMessage=model unavailable',
          'PARSER_HTTP_ERROR',
          500,
        );
      },
    }),
    store,
    { maxAttempts: 1 },
  );

  const record = await service.start(makeInput());

  assert.equal(record.status, 'FALLBACK_REQUIRED');
  assert.equal(record.errorCode, 'PARSER_HTTP_ERROR');
  assert.match(record.errorMessage ?? '', /PARSER_ERROR/);
  assert.match(record.errorMessage ?? '', /model unavailable/);
});

test('modo feature-safe não chama o parser quando a funcionalidade está desativada', async () => {
  let parseCalls = 0;
  const service = new DocumentParseOrchestratorService(
    makeAdapter({
      parse: async () => {
        parseCalls++;
        return {
          parseRunId: 'parse-run-should-not-happen',
          status: 'PROCESSING',
          statusUrl: 'http://parser.test/v1/parse/parse-run-should-not-happen',
          resultUrl: 'http://parser.test/v1/parse/parse-run-should-not-happen/result',
          idempotencyKey: 'should-not-happen',
        };
      },
    }),
    new MemoryParseRunStore(),
    {
      featureEnabled: false,
      now: () => new Date('2026-08-26T00:00:00.000Z'),
    },
  );

  const record = await service.start(makeInput());

  assert.equal(parseCalls, 0);
  assert.equal(record.status, 'FALLBACK_REQUIRED');
});
