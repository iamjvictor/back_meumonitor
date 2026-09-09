import assert from 'node:assert/strict';
import test from 'node:test';
import type { QuestionEvidenceResult } from '../../models/question-evidence.model.js';
import { buildQuestionEvidenceContext } from '../question-evidence.context.js';

const evidence: QuestionEvidenceResult = {
  strategy: 'DIRECT_QUESTION_SOURCE',
  sufficient: true,
  questionId: 'question-1',
  answer: 'C',
  explanation: 'Converta metros para centímetros antes de calcular.',
  citations: [{
    chunkId: 'chunk-answer',
    documentId: 'document-1',
    blockId: 'block-answer',
    role: 'ANSWER_KEY',
    content: 'A resposta oficial é C.',
    confidence: 0.98,
    pageStart: 4,
    pageEnd: 4,
  }],
  context: '',
  metrics: {
    sourceCount: 1,
    chunkCount: 1,
    answerKeyCount: 1,
    explanationCount: 0,
    durationMs: 4,
  },
};

test('monta gabarito, explicação e fontes oficiais em ordem pedagógica', () => {
  const context = buildQuestionEvidenceContext(evidence);

  assert.ok(context.indexOf('[GABARITO OFICIAL]') < context.indexOf('[EXPLICAÇÃO OFICIAL]'));
  assert.match(context, /resposta oficial é C/);
  assert.match(context, /Converta metros/);
  assert.match(context, /ANSWER_KEY/);
  assert.match(context, /document-1/);
  assert.match(context, /Página: 4/);
  assert.match(context, /Confiança: 0.98/);
});

test('não adiciona seções vazias quando a questão tem somente resposta direta', () => {
  const context = buildQuestionEvidenceContext({
    ...evidence,
    explanation: null,
    citations: [],
  });

  assert.match(context, /\[GABARITO OFICIAL\]/);
  assert.doesNotMatch(context, /\[EXPLICAÇÃO OFICIAL\]/);
  assert.doesNotMatch(context, /\[FONTES OFICIAIS\]/);
});
