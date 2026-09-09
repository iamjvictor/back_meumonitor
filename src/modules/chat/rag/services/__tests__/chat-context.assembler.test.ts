import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatRagResult } from '../../models/chat-rag.model.js';
import type { ChatHistoryMessage } from '../../../models/chat-history.model.js';
import type { AuthorizedQuestionContext } from '../../../models/chat-generation.model.js';
import { ChatContextAssembler } from '../chat-context.assembler.js';

const questionContext: AuthorizedQuestionContext = {
  questionId: 'question-1',
  questionAttemptId: null,
  monitorId: 'monitor-1',
  subjectId: 'subject-1',
  topicId: 'topic-1',
  number: 3,
  topic: 'Dinâmica',
  statement: 'Um motorista reage ao freio em velocidade constante.',
  options: [{ label: 'A', text: '14 metros' }],
  selectedOption: 'A',
};

const history: ChatHistoryMessage[] = [
  { id: 'history-1', role: 'student', content: 'O que é velocidade?', createdAt: '2026-09-07T12:00:00.000Z' },
  { id: 'history-2', role: 'assistant', content: 'É a relação entre distância e tempo.', createdAt: '2026-09-07T12:00:01.000Z' },
];

function makeRagResult(overrides: Partial<ChatRagResult> = {}): ChatRagResult {
  return {
    used: true,
    retrievalQuery: 'consulta',
    context: 'contexto bruto',
    citations: [
      {
        chunkId: 'chunk-1',
        documentId: 'document-1',
        blockId: 'block-1',
        pageStart: 2,
        pageEnd: 2,
        score: 0.9,
        content: 'A velocidade média relaciona deslocamento e intervalo de tempo.',
      },
      {
        chunkId: 'chunk-2',
        documentId: 'document-1',
        blockId: 'block-1',
        pageStart: 2,
        pageEnd: 2,
        score: 0.8,
        content: 'Este conteúdo duplicado não deve aparecer duas vezes.',
      },
    ],
    metrics: { candidateCount: 2, selectedCount: 2, durationMs: 12 },
    ...overrides,
  };
}

test('monta contexto delimitado com questão, histórico, evidências e dúvida', () => {
  const context = new ChatContextAssembler().assemble({
    message: 'Pode explicar passo a passo?',
    history,
    questionContext,
    rag: makeRagResult(),
  });

  assert.match(context, /\[QUESTÃO OFICIAL\]/);
  assert.match(context, /\[HISTÓRICO RELEVANTE\]/);
  assert.match(context, /\[EVIDÊNCIAS RECUPERADAS\]/);
  assert.match(context, /\[DÚVIDA ATUAL DO ALUNO\]/);
  assert.match(context, /Um motorista reage ao freio/);
  assert.match(context, /O que é velocidade/);
  assert.match(context, /A velocidade média relaciona/);
  assert.match(context, /Pode explicar passo a passo/);
});

test('deduplica evidências pelo bloco e informa quando o RAG não encontrou conteúdo', () => {
  const assembler = new ChatContextAssembler();
  const withEvidence = assembler.assemble({ message: 'Explique.', history: [], questionContext: null, rag: makeRagResult() });
  const withoutEvidence = assembler.assemble({
    message: 'Explique.',
    history: [],
    questionContext: null,
    rag: makeRagResult({ used: false, citations: [], context: '' }),
  });

  assert.equal(withEvidence.match(/Evidência 1/g)?.length, 1);
  assert.doesNotMatch(withEvidence, /Evidência 2/);
  assert.match(withoutEvidence, /Nenhuma evidência relevante foi recuperada/);
});

test('limita o contexto e preserva a dúvida atual', () => {
  const context = new ChatContextAssembler({ maxChars: 500 }).assemble({
    message: 'DÚVIDA FINAL QUE PRECISA SER PRESERVADA',
    history: [],
    questionContext: null,
    rag: makeRagResult({
      citations: [{
        ...makeRagResult().citations[0]!,
        content: 'x'.repeat(4_000),
      }],
    }),
  });

  assert.ok(context.length <= 500);
  assert.match(context, /DÚVIDA FINAL QUE PRECISA SER PRESERVADA/);
});

test('preserva o gabarito oficial quando o limite de contexto é pequeno', () => {
  const context = new ChatContextAssembler({ maxChars: 220 }).assemble({
    message: 'Explique o motivo.',
    history: [],
    questionContext,
    rag: makeRagResult({
      context: '[GABARITO OFICIAL]\nC\n\n[EXPLICAÇÃO OFICIAL]\nA conversão correta usa a mesma unidade.',
      citations: [],
    }),
  });

  assert.ok(context.length <= 220);
  assert.match(context, /\[GABARITO OFICIAL\]/);
  assert.match(context, /C/);
  assert.match(context, /Explique o motivo/);
});
