import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { PrismaQuestionEvidenceProvider } from '../prisma-question-evidence.provider.js';

function makeQuestion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'question-1',
    correctAnswer: 'C',
    correctAnswerConfidence: 0.96,
    explanation: 'Converta as unidades antes de calcular a razão.',
    explanationConfidence: 0.91,
    sources: [
      {
        role: 'EXPLANATION',
        confidence: 0.91,
        excerpt: 'Converta as unidades antes de calcular a razão.',
        chunkId: 'chunk-explanation',
        documentId: 'document-1',
        documentBlockId: 'block-explanation',
        chunk: {
          id: 'chunk-explanation',
          content: 'Converta as unidades antes de calcular a razão.',
          status: 'READY',
          pageStart: 4,
          pageEnd: 4,
          blockId: 'block-explanation',
          documentId: 'document-1',
        },
        documentBlock: {
          id: 'block-explanation',
          type: 'SOLUTION',
          normalizedContent: 'Converta as unidades antes de calcular a razão.',
          pageStart: 4,
          pageEnd: 4,
        },
      },
      {
        role: 'ANSWER_KEY',
        confidence: 0.99,
        excerpt: 'Resposta: C',
        chunkId: 'chunk-answer',
        documentId: 'document-1',
        documentBlockId: 'block-answer',
        chunk: {
          id: 'chunk-answer',
          content: 'Resposta: C',
          status: 'READY',
          pageStart: 5,
          pageEnd: 5,
          blockId: 'block-answer',
          documentId: 'document-1',
        },
        documentBlock: {
          id: 'block-answer',
          type: 'ANSWER_KEY',
          normalizedContent: 'Resposta: C',
          pageStart: 5,
          pageEnd: 5,
        },
      },
    ],
    ...overrides,
  };
}

test('carrega gabarito e explicação por QuestionSource mesmo sem embedding no chunk', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    question: {
      async findFirst(input: Record<string, unknown>) {
        calls.push(input);
        return makeQuestion();
      },
    },
  } as unknown as PrismaClient;
  const provider = new PrismaQuestionEvidenceProvider(client);

  const result = await provider.get({
    questionId: 'question-1',
    teacherId: 'teacher-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.where, {
    id: 'question-1',
    teacherId: 'teacher-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
  });
  assert.ok(result);
  assert.equal(result.sufficient, true);
  assert.deepEqual(result.citations.map((citation) => citation.role), ['ANSWER_KEY', 'EXPLANATION']);
  assert.equal(result.citations[0]?.chunkId, 'chunk-answer');
  assert.match(result.context, /Resposta: C/);
  assert.match(result.context, /Converta as unidades/);
  assert.equal(result.metrics.answerKeyCount, 1);
  assert.equal(result.metrics.explanationCount, 1);
});

test('retorna nulo quando a questão não pertence ao escopo autorizado', async () => {
  const client = {
    question: { async findFirst() { return null; } },
  } as unknown as PrismaClient;
  const provider = new PrismaQuestionEvidenceProvider(client);

  assert.equal(await provider.get({
    questionId: 'question-outro',
    teacherId: 'teacher-1',
    monitorId: 'monitor-outro',
    subjectId: 'subject-outro',
  }), null);
});

test('não considera fonte pendente como evidência oficial pronta', async () => {
  const pending = makeQuestion({
    correctAnswer: null,
    correctAnswerConfidence: null,
    explanation: null,
    explanationConfidence: null,
    sources: [{
      role: 'ANSWER_KEY',
      confidence: 0.8,
      excerpt: 'Resposta pendente',
      chunkId: 'chunk-pending',
      documentId: 'document-1',
      documentBlockId: 'block-pending',
      chunk: {
        id: 'chunk-pending',
        content: 'Resposta pendente',
        status: 'EMBEDDING_PENDING',
        pageStart: null,
        pageEnd: null,
        blockId: 'block-pending',
        documentId: 'document-1',
      },
      documentBlock: null,
    }],
  });
  const client = {
    question: { async findFirst() { return pending; } },
  } as unknown as PrismaClient;
  const provider = new PrismaQuestionEvidenceProvider(client);

  const result = await provider.get({
    questionId: 'question-1',
    teacherId: 'teacher-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
  });

  assert.ok(result);
  assert.equal(result.sufficient, false);
  assert.equal(result.citations.length, 0);
});
