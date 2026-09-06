import { assessQuestionQuality, validateQuestionStructure } from '../worker/services/question-quality.service.js';
import { splitQuestionBlockContent } from '../worker/services/question-extraction.service.js';
import { validateQuestionStatementEvidence } from '../worker/services/question-statement-evidence.service.js';

const alternatives = ['A', 'B', 'C', 'D', 'E'].map((label) => ({
  label,
  text: `Alternativa ${label} plausível para o enunciado.`,
}));

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const valid = assessQuestionQuality({
  text: 'Qual é o resultado da operação apresentada no enunciado?',
  alternatives,
  correctAnswer: 'A',
  explanation: 'A alternativa A apresenta o resultado obtido pela operação.',
});
assert(valid.structuralValid, 'questão válida deveria passar na estrutura');
assert(valid.reasons.length === 0, 'questão válida não deveria ter motivos');

const contaminated = assessQuestionQuality({
  text: 'Qual é a área da figura?',
  alternatives: [
    { label: 'A', text: '12 cm². Questão 15. Resolva o próximo item.' },
    ...alternatives.slice(1),
  ],
  correctAnswer: 'A',
  explanation: 'A alternativa A apresenta a área calculada.',
});
assert(contaminated.reasons.includes('CONTAMINATED_ALTERNATIVES'), 'contaminação deveria ser detectada');
assert(contaminated.recommendedAction === 'REPROCESS', 'contaminação deveria recomendar reprocessamento');

const incomplete = validateQuestionStructure({
  text: 'Em um tribunal, há 210 processos para serem analisados pelos juízes A, B e',
  alternatives,
});
assert(incomplete.processingState === 'STRUCTURALLY_INVALID', 'enunciado incompleto deveria ser bloqueado');
assert(incomplete.recommendedAction === 'REPROCESS', 'fragmento deveria recomendar reprocessamento');

const convertible = validateQuestionStructure({
  text: 'Uma escola possui 120 alunos. Quantos alunos representam metade desse total?',
  alternatives: [{ label: 'A', text: '60 alunos' }],
});
assert(convertible.processingState === 'CONVERTIBLE_TO_MULTIPLE_CHOICE', 'questão com alternativas incompletas deveria ser conversível');

const colonBeforeAlternatives = validateQuestionStructure({
  text: 'Determine a quantidade solicitada no problema:',
  alternatives,
});
assert(!colonBeforeAlternatives.reasons.includes('INCOMPLETE_STATEMENT'), 'dois-pontos antes das alternativas não indicam fragmento');

const split = splitQuestionBlockContent('1) Qual é a razão entre 10 e 2? 2) Qual é a razão entre 20 e 4?');
assert(split.length === 2, 'questões consecutivas deveriam ser segmentadas');

const generated = assessQuestionQuality({
  text: 'Determine a medida solicitada no problema.',
  alternatives,
  correctAnswer: 'A',
  explanation: 'A alternativa A corresponde ao cálculo realizado.',
  generatedAlternatives: true,
});
assert(generated.reasons.includes('ALTERNATIVES_GENERATED'), 'geração de alternativas deveria ser registrada');
assert(generated.score < valid.score, 'geração de alternativas deveria reduzir o score');

const contradiction = assessQuestionQuality({
  text: 'Qual alternativa responde corretamente ao problema?',
  alternatives,
  correctAnswer: 'A',
  explanation: 'A alternativa B é a correta porque apresenta o resultado.',
});
assert(contradiction.reasons.includes('ANSWER_EXPLANATION_CONTRADICTION'), 'contradição deveria ser detectada');
assert(contradiction.severity === 'CRITICAL', 'contradição deveria ser crítica');

const missingFigure = assessQuestionQuality({
  text: 'A figura mostra duas retas. Qual é a medida do ângulo indicado?',
  alternatives,
  correctAnswer: 'A',
  explanation: 'A alternativa A corresponde ao ângulo mostrado na figura.',
});
assert(missingFigure.reasons.includes('MISSING_FIGURE'), 'referência visual sem ativo extraído deveria ser bloqueada');

const availableFigure = assessQuestionQuality({
  text: 'Observe a figura e determine a área sombreada da região apresentada.',
  alternatives,
  correctAnswer: 'A',
  explanation: 'A alternativa A apresenta o cálculo compatível com a figura.',
  visualEvidenceAvailable: true,
});
assert(!availableFigure.reasons.includes('MISSING_FIGURE'), 'referência visual com ativo detectado não deveria ser bloqueada');
assert(missingFigure.recommendedAction === 'REPROCESS', 'questão dependente de figura deveria pedir reprocessamento');

const statementWithEvidence = validateQuestionStatementEvidence(
  'Quantos litros de tinta amarela sao necessarios para obter 30 litros de tinta marrom?',
  [{ content: '7) Quantos litros de tinta amarela sao necessarios para obter 30 litros de tinta marrom?\na) 7 b) 8 c) 9 d) 10 e) 11' }],
);
assert(statementWithEvidence.valid, 'enunciado presente no chunk deveria passar');

const orphanStatement = validateQuestionStatementEvidence(
  'Qual a parte correspondente de cada um?',
  [{ content: 'socio A investiu R$ 60.000,00, o socio B R$ 40.000,00' }],
);
assert(!orphanStatement.valid, 'pergunta sem contexto/documento completo deveria ser bloqueada');

const continuationStatement = validateQuestionStatementEvidence(
  'e depois do restante. O que sobrou foi vendido por R$ 1.400,00.',
  [{ content: 'de tecido e depois do restante. O que sobrou foi vendido por R$ 1.400,00.' }],
);
assert(!continuationStatement.valid, 'enunciado iniciado como continuacao deveria ser bloqueado');

const prepositionStatement = validateQuestionStatementEvidence(
  'Dos 135 funcionarios, 2/3 moram no Rio de Janeiro. Quantos usam as barcas?',
  [{ content: '4) Dos 135 funcionarios, 2/3 moram no Rio de Janeiro. Quantos usam as barcas?' }],
);
assert(prepositionStatement.valid, 'preposicao no inicio de um enunciado valido nao deve ser tratada como continuacao');

const mergedStatement = validateQuestionStatementEvidence(
  'Se ele juntar os conteudos, qual sera a proporcao? 0. (OBMEP 2020) Uma nova questao.',
  [{ content: 'Se ele juntar os conteudos, qual sera a proporcao? 0. (OBMEP 2020) Uma nova questao.' }],
);
assert(!mergedStatement.valid, 'enunciado com inicio da proxima questao deveria ser bloqueado');

const multiItemStatement = validateQuestionStatementEvidence(
  'Determine o valor de x em cada uma das proporcoes a seguir:',
  [{ content: '4. Determine o valor de x em cada uma das proporcoes a seguir: a) x/2 = 3/4 b) x/5 = 2/3' }],
);
assert(!multiItemStatement.valid, 'atividade com subitens nao deve seguir como uma unica multipla escolha');

const visualStatement = validateQuestionStatementEvidence(
  'A figura apresenta a vista do setor e pergunta a razao entre as cadeiras.',
  [{ content: 'A figura apresenta a vista do setor e pergunta a razao entre as cadeiras.' }],
);
assert(!visualStatement.valid, 'questao dependente de figura sem ativo visual nao deve seguir por texto');

console.log('question-quality: OK');
