import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateQuestionCandidatePromotion } from '../question-extraction.service.js';

const baseChunk = {
  id: 'chunk-1',
  documentId: 'document-1',
  chunkIndex: 0,
  blockId: 'block-1',
  content: '',
  charStart: 0,
  charEnd: 120,
  block: { pageStart: 1, pageEnd: 1 },
  pageHasImages: false,
} as const;

const baseCandidate = {
  text: 'Um barco recolhe 30 naufragos numa ilha. Quantas pessoas havia no barco antes dele chegar a ilha?',
  kind: 'MULTIPLE_CHOICE' as const,
  alternatives: [
    { label: 'A', text: '15' },
    { label: 'B', text: '40' },
    { label: 'C', text: '110' },
  ],
  correctAnswer: null,
  explanation: null,
  topicId: null,
  relatedTopics: [],
  sourceChunkIndexes: [0],
  answerSourceChunkIndexes: [],
  explanationSourceChunkIndexes: [],
  sourceBlockId: '11111111-1111-1111-1111-111111111111',
  questionNumber: '59',
};

test('resolve fallback de topico quando a classificacao nao retorna principal', async () => {
  const { resolveQuestionTopic } = await import('../question-extraction.service.js');

  assert.deepEqual(resolveQuestionTopic(null, [{ id: 'topic-1' }, { id: 'topic-2' }]), {
    topicId: 'topic-1',
    pendingReview: false,
  });
});

test('permite completion para candidata convertivel com evidencia ancorada', () => {
  const decision = evaluateQuestionCandidatePromotion({
    candidate: baseCandidate,
    sourceChunks: [
      {
        ...baseChunk,
        content: `${baseCandidate.text}\na) 15 b) 40 c) 110`,
      },
    ],
  });

  assert.equal(decision.completionBlocked, false);
  assert.equal(decision.candidateStatus, 'READY_FOR_COMPLETION');
  assert.equal(decision.sourceStructure.processingState, 'CONVERTIBLE_TO_MULTIPLE_CHOICE');
});

test('permite completion para candidata sem alternativas quando o enunciado tem evidencia textual', () => {
  const decision = evaluateQuestionCandidatePromotion({
    candidate: {
      ...baseCandidate,
      alternatives: [],
    },
    sourceChunks: [
      {
        ...baseChunk,
        content: baseCandidate.text,
      },
    ],
  });

  assert.equal(decision.completionBlocked, false);
  assert.equal(decision.candidateStatus, 'READY_FOR_COMPLETION');
  assert.equal(decision.sourceStructure.processingState, 'CONVERTIBLE_TO_MULTIPLE_CHOICE');
  assert.match(decision.promotionReasons.join(' '), /MISSING_ALTERNATIVES/);
});

test('permite enunciado declarativo de multipla escolha com cinco alternativas', () => {
  const alternatives = [
    { label: 'A', text: 'diretamente proporcional ao tempo' },
    { label: 'B', text: 'inversamente proporcional ao tempo' },
    { label: 'C', text: 'diretamente proporcional ao quadrado do tempo' },
    { label: 'D', text: 'inversamente proporcional ao quadrado do tempo' },
    { label: 'E', text: 'diretamente proporcional a velocidade' },
  ];

  for (const text of [
    'No movimento retilineo uniformemente variado, a distancia percorrida e:',
    'Um veiculo parte do repouso. Pode-se dizer que sua velocidade apos 3 segundos e:',
    'A aceleracao escalar do ponto material, em m/s2, vale:',
  ]) {
    const decision = evaluateQuestionCandidatePromotion({
      candidate: { ...baseCandidate, text, alternatives },
      sourceChunks: [{ ...baseChunk, content: `${text}\na) resposta b) resposta c) resposta d) resposta e) resposta` }],
    });

    assert.equal(decision.completionBlocked, false, text);
    assert.equal(decision.candidateStatus, 'READY_FOR_COMPLETION', text);
    assert.doesNotMatch(decision.promotionReasons.join(' '), /NON_QUESTION_BLOCK/, text);
  }
});

test('permite completion para enunciado truncado quando a falta de contexto e recuperavel pelos chunks fonte', () => {
  const text = 'Quantas pessoas havia no barco antes dele chegar a ilha?';
  const decision = evaluateQuestionCandidatePromotion({
    candidate: {
      ...baseCandidate,
      text,
      alternatives: [],
    },
    sourceChunks: [
      {
        ...baseChunk,
        content: '(Mexico) Um barco recolhe 30 naufragos numa ilha. Como resultado, os alimentos do barco que eram suficientes para 60 dias, agora serao suficientes para 50 dias. Quantas pessoas havia no barco antes dele chegar a ilha?',
      },
    ],
  });

  assert.equal(decision.statementEvidence.valid, false);
  assert.match(
    decision.promotionReasons.join(' '),
    /STATEMENT_OMITS_LEADING_CONTEXT/,
  );
  assert.equal(decision.completionBlocked, false);
  assert.equal(decision.candidateStatus, 'READY_FOR_COMPLETION');
});

test('promove continuacao truncada com alternativas ausentes quando o chunk contem o contexto', () => {
  const text = 'Calcule quantos livros uma escola recebeu e';
  const decision = evaluateQuestionCandidatePromotion({
    candidate: {
      ...baseCandidate,
      text,
      alternatives: [],
    },
    sourceChunks: [
      {
        ...baseChunk,
        content: 'Calcule quantos livros uma escola recebeu e distribuiu 45 para a biblioteca. Quantos livros restaram?',
      },
    ],
  });

  assert.equal(decision.sourceStructure.processingState, 'STRUCTURALLY_INVALID');
  assert.match(decision.promotionReasons.join(' '), /ENDS_AS_CONTINUATION/);
  assert.equal(decision.completionBlocked, false);
  assert.equal(decision.candidateStatus, 'READY_FOR_COMPLETION');
});

test('promove continuacao sem verbo interrogativo quando os chunks contem evidencia suficiente', () => {
  const text = 'restaram na escola.';
  const decision = evaluateQuestionCandidatePromotion({
    candidate: {
      ...baseCandidate,
      text,
      alternatives: [],
    },
    sourceChunks: [
      {
        ...baseChunk,
        content: 'Uma escola recebeu 120 livros e distribuiu 45 para a biblioteca. Quantos livros restaram na escola.',
      },
    ],
  });

  assert.equal(decision.completionBlocked, false);
  assert.equal(decision.candidateStatus, 'READY_FOR_COMPLETION');
});

test('mantem bloqueio para nao-questao mesmo com chunk ancorado', () => {
  const decision = evaluateQuestionCandidatePromotion({
    candidate: {
      ...baseCandidate,
      text: 'Lista de materiais para aula pratica',
      alternatives: [],
    },
    sourceChunks: [
      {
        ...baseChunk,
        content: 'Lista de materiais para aula pratica',
      },
    ],
  });

  assert.equal(decision.completionBlocked, true);
  assert.equal(decision.sourceStructure.processingState, 'STRUCTURALLY_INVALID');
  assert.match(decision.promotionReasons.join(' '), /NON_QUESTION_BLOCK/);
});

test('mantem bloqueio para multiplas questoes no mesmo candidato', () => {
  const text = '1. Quanto e 2 + 2? 2. Quanto e 3 + 3?';
  const decision = evaluateQuestionCandidatePromotion({
    candidate: {
      ...baseCandidate,
      text,
      alternatives: [],
    },
    sourceChunks: [
      {
        ...baseChunk,
        content: text,
      },
    ],
  });

  assert.equal(decision.completionBlocked, true);
  assert.equal(decision.sourceStructure.processingState, 'STRUCTURALLY_INVALID');
  assert.match(decision.promotionReasons.join(' '), /MULTIPLE_QUESTIONS/);
});

test('mantem bloqueio quando falta evidencia visual', () => {
  const text = 'Observe a figura e determine o valor de x.';
  const decision = evaluateQuestionCandidatePromotion({
    candidate: {
      ...baseCandidate,
      text,
      alternatives: [],
    },
    sourceChunks: [
      {
        ...baseChunk,
        content: text,
      },
    ],
  });

  assert.equal(decision.completionBlocked, true);
  assert.equal(decision.candidateStatus, 'VISUAL_PENDING');
  assert.match(decision.promotionReasons.join(' '), /MISSING_VISUAL_EVIDENCE|VISUAL_EVIDENCE_PENDING/);
});

test('mantem bloqueio quando o enunciado nao esta ancorado nos chunks', () => {
  const decision = evaluateQuestionCandidatePromotion({
    candidate: {
      ...baseCandidate,
      alternatives: [],
    },
    sourceChunks: [
      {
        ...baseChunk,
        content: 'Texto de outra questao sem relacao com o enunciado candidato.',
      },
    ],
  });

  assert.equal(decision.completionBlocked, true);
  assert.equal(decision.candidateStatus, 'BLOCKED');
  assert.match(decision.promotionReasons.join(' '), /SOURCE_ANCHOR_NOT_FOUND/);
});
