import assert from 'node:assert/strict';
import { MineruParserAdapter } from '../worker/services/document-parser/mineru-parser.adapter.js';
import {
  DocumentParseOrchestratorService,
  MemoryParseRunStore,
} from '../worker/services/document-parser/document-parse-orchestrator.service.js';

const requests: Array<{ url: string; method: string; body?: string }> = [];
const fetchMock: typeof fetch = async (input, init) => {
  const url = String(input);
  requests.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : undefined });

  if (url.endsWith('/v1/parse')) {
    return new Response(JSON.stringify({
      parseRunId: 'parse-run-1',
      status: 'PROCESSING',
      statusUrl: 'http://parser.test/v1/parse/parse-run-1',
      resultUrl: 'http://parser.test/v1/parse/parse-run-1/result',
      idempotencyKey: 'doc-1:hash-1:MINERU:unknown-parser-version:pipeline:unknown-model-version:config-1:unknown-schema-version',
    }), { status: 202, headers: { 'content-type': 'application/json' } });
  }

  if (url.endsWith('/result')) {
    return new Response(JSON.stringify({
      schemaVersion: 'layout-v1',
      documentId: 'doc-1',
      parseRunId: 'parse-run-1',
      parser: { name: 'MINERU', version: '3.4.5', configurationHash: 'config-1' },
      pages: [],
      assets: [],
      warnings: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  return new Response(JSON.stringify({
    parseRunId: 'parse-run-1',
    status: 'COMPLETED',
    progress: 100,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const adapter = new MineruParserAdapter({
  baseUrl: 'http://parser.test',
  fetchImpl: fetchMock,
});
const store = new MemoryParseRunStore();
const service = new DocumentParseOrchestratorService(adapter, store, {
  now: () => new Date('2026-08-26T00:00:00.000Z'),
});
const input = {
  documentId: 'doc-1',
  fileUrl: 'https://storage.test/doc-1.pdf',
  fileBytes: new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 102, 105, 120, 116, 117, 114, 101, 10]),
  fileName: 'doc-1.pdf',
  contentHash: 'hash-1',
  parser: 'MINERU' as const,
  backend: 'pipeline',
  configurationHash: 'config-1',
};

const first = await service.start(input);
const second = await service.start(input);
assert.equal(first.parseRunId, 'parse-run-1');
assert.equal(second.parseRunId, first.parseRunId);
assert.equal(requests.filter((request) => request.method === 'POST').length, 1);

const status = await service.status(first.parseRunId);
assert.equal(status.status, 'COMPLETED');

const layout = await service.result(first.parseRunId);
assert.equal(layout.parser.name, 'MINERU');
assert.equal(layout.parseRunId, first.parseRunId);
assert.equal(requests.length, 3);

console.log('document parser contract: OK');
