import assert from 'node:assert/strict';
import test from 'node:test';
import { formatProcessingStageReport } from '../processing-time-report.service.js';

test('formata uma marca de tempo de etapa com resultado e duracao', () => {
  const report = formatProcessingStageReport({
    documentId: 'document-1',
    stage: 'GENERATE_CHUNK_EMBEDDINGS',
    status: 'READY',
    startedAt: '2026-09-22T12:00:00.000Z',
    finishedAt: '2026-09-22T12:00:02.345Z',
    durationMs: 2345,
    attempt: 2,
  });

  assert.match(report, /### Etapa: GENERATE_CHUNK_EMBEDDINGS/);
  assert.match(report, /Documento ID: `document-1`/);
  assert.match(report, /Status: READY/);
  assert.match(report, /Iniciado em: 2026-09-22T12:00:00\.000Z/);
  assert.match(report, /Finalizado em: 2026-09-22T12:00:02\.345Z/);
  assert.match(report, /Duracao: 2345 ms \(2\.35 s\)/);
  assert.match(report, /Tentativa: 2/);
});

test('formata erro da etapa sem exigir dados opcionais', () => {
  const report = formatProcessingStageReport({
    documentId: 'document-2',
    stage: 'PARSE_DOCLING',
    status: 'FAILED',
    startedAt: '2026-09-22T12:00:00.000Z',
    finishedAt: '2026-09-22T12:00:00.500Z',
    durationMs: 500,
    error: 'Parser respondeu HTTP 404',
  });

  assert.match(report, /Status: FAILED/);
  assert.match(report, /Duracao: 500 ms \(0\.50 s\)/);
  assert.match(report, /Erro: Parser respondeu HTTP 404/);
  assert.doesNotMatch(report, /Tentativa: undefined/);
});
