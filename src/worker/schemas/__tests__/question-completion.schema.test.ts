import assert from 'node:assert/strict';
import test from 'node:test';
import {
  questionQualityCorrectionZodSchema,
  questionQualityReviewZodSchema,
} from '../question-completion.schema.js';

test('aceita alternativa matematica longa gerada a partir de formula', () => {
  const result = questionQualityCorrectionZodSchema.safeParse({
    action: 'CORRECT',
    changes: {
      statement: 'Qual e a equacao geral da reta?',
      alternatives: [
        {
          label: 'A',
          text: 'A area de um poligono e dada por ± · |x1y2 + x2y3 + ... + xny1 - x2y1 - x3y2 - ... - x1yn| / 2, relacionando os vertices na ordem correta e mantendo os termos na ordem ciclica indicada pelo enunciado original.',
        },
      ],
      correctAnswer: 'A',
      explanation: 'A alternativa A apresenta a expressao correta.',
      changedFields: ['alternatives'],
    },
    confidence: 0.9,
    evidence: ['A igualdade apresentada no contexto confirma a forma matematica usada para avaliar a alternativa e a relacao entre os vertices.'],
  });

  assert.equal(result.success, true);
});

test('aceita evidencias longas o suficiente para preservar contexto matematico', () => {
  const result = questionQualityReviewZodSchema.safeParse({
    valid: false,
    score: 20,
    severity: 'CRITICAL',
    confidence: 1,
    reasons: ['O enunciado esta incompleto e a resposta correta nao pode ser confirmada com seguranca porque a formula foi fragmentada entre colunas, a ordem dos termos foi alterada e as alternativas preservaram apenas partes desconectadas da expressao matematica original.'],
    recommendedAction: 'REVIEW',
  });

  assert.equal(result.success, true);
});
