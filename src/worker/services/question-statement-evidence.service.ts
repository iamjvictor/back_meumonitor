export type StatementEvidenceReason =
  | 'EMPTY_STATEMENT'
  | 'SOURCE_ANCHOR_NOT_FOUND'
  | 'STATEMENT_OMITS_LEADING_CONTEXT'
  | 'STARTS_AS_CONTINUATION'
  | 'ENDS_AS_CONTINUATION'
  | 'CONTAINS_NEXT_QUESTION'
  | 'MULTI_ITEM_ACTIVITY'
  | 'MISSING_VISUAL_EVIDENCE';

export type StatementEvidenceValidation = {
  valid: boolean;
  reasons: StatementEvidenceReason[];
  sourceMatch: 'EXACT' | 'TOKEN_OVERLAP' | 'NONE';
};

type SourceChunk = { content: string };

// Preposicoes podem iniciar perfeitamente um enunciado ("Dos 135...",
// "Em uma caixa...", "Para transportar..."). Somente conectivos reais,
// preservando caixa baixa, indicam que o texto comecou no meio da frase.
const LEADING_CONTINUATION = /^(?:e|ou|mas|porém|portanto|assim)\b|^Ainda assim\b/u;
const TRAILING_CONTINUATION = /(?:\b(?:e|ou|que|de|da|do|dos|das|para|com|em|por|se|é|são|foi|será|tem|têm|corrigiu|produziu)\s*|\bse\s*:)$/iu;
const MULTI_ITEM = /(?:^|\n)\s*(?:[a-d][).]|item\s+[a-d])\s+/iu;
const MULTI_ITEM_INSTRUCTION = /\b(?:em cada uma|em cada um|itens? a seguir|fa[çc]a o que se pede)\b/iu;
const GENERIC_PROMPT = /^(?:qual|quanto|quantos|quantas|determine|calcule|resolva|indique|assinale|sabendo-se)\b/iu;
const NEXT_QUESTION = /(?:[?!.]|\b[ABCDE][).])\s*(?:quest[aã]o\s*)?\d{1,3}[.)]\s*(?:\(|[A-ZÀ-Ý])/u;
const VISUAL_REFERENCE = /\b(?:figura|imagem|ilustra[cç][aã]o|fotografia|foto|etiqueta|gr[aá]fico|mapa|tabela)\b/iu;

function compact(value: string) {
  return value.replace(/\s+/gu, ' ').trim();
}

function comparable(value: string) {
  return compact(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR');
}

function meaningfulTokens(value: string) {
  const ignored = new Set(['para', 'como', 'com', 'uma', 'que', 'dos', 'das']);
  return comparable(value)
    .match(/[\p{L}\p{N}]{3,}/gu)
    ?.filter((token) => !ignored.has(token))
    ?? [];
}

/**
 * Validates only the evidence needed to form a statement. It deliberately
 * does not require alternatives, answer or explanation: those belong to the
 * later completion stages. Keeping this gate deterministic prevents an LLM
 * from trying to repair a candidate whose statement is not in its chunks.
 */
export function validateQuestionStatementEvidence(
  statement: string,
  sourceChunks: SourceChunk[],
): StatementEvidenceValidation {
  const normalizedStatement = compact(statement);
  const reasons: StatementEvidenceReason[] = [];
  if (!normalizedStatement) reasons.push('EMPTY_STATEMENT');

  const comparableStatement = comparable(normalizedStatement);
  const comparableSource = comparable(sourceChunks.map((chunk) => chunk.content).join('\n'));
  let sourceMatch: StatementEvidenceValidation['sourceMatch'] = 'NONE';
  if (comparableStatement.length >= 12 && comparableSource.includes(comparableStatement)) {
    sourceMatch = 'EXACT';
  } else {
    const tokens = Array.from(new Set(meaningfulTokens(normalizedStatement))).slice(0, 10);
    const matchingTokens = tokens.filter((token) => comparableSource.includes(token));
    const requiredMatches = Math.min(4, Math.max(2, Math.ceil(tokens.length * 0.6)));
    if (tokens.length >= 2 && matchingTokens.length >= requiredMatches) sourceMatch = 'TOKEN_OVERLAP';
  }

  if (sourceMatch === 'NONE') reasons.push('SOURCE_ANCHOR_NOT_FOUND');
  // A frase "Determine a razao entre:" pode existir literalmente no chunk,
  // mas ainda ser apenas a segunda metade da questao. Quando ha dados
  // quantitativos imediatamente antes de um comando generico, o enunciado
  // extraido omitiu o contexto necessario e precisa voltar para reextracao.
  if (sourceMatch === 'EXACT' && GENERIC_PROMPT.test(normalizedStatement)) {
    const sourceWithAnchor = sourceChunks.find((chunk) => comparable(chunk.content).includes(comparableStatement));
    const comparableChunk = comparable(sourceWithAnchor?.content ?? '');
    const anchor = comparableChunk.indexOf(comparableStatement);
    const rawPrefix = anchor > 0 ? comparableChunk.slice(Math.max(0, anchor - 450), anchor) : '';
    // Ignore a previous numbered question when a structural block still
    // contains more than one item. Only the text after the latest boundary
    // can be missing context for this candidate.
    const lastQuestionBoundary = Math.max(
      rawPrefix.lastIndexOf('\n'),
      rawPrefix.search(/(?:^|\n)\s*(?:quest[aã]o\s*)?\d{1,3}[.)]\s+/iu),
    );
    const prefix = lastQuestionBoundary >= 0 ? rawPrefix.slice(lastQuestionBoundary + 1) : rawPrefix;
    if (prefix.length > 20 && /(?:R\$|\d{2,}|%|metros?|oper[aá]rios?|caixas?)/iu.test(prefix)) {
      reasons.push('STATEMENT_OMITS_LEADING_CONTEXT');
    }
  }
  if (LEADING_CONTINUATION.test(normalizedStatement)) reasons.push('STARTS_AS_CONTINUATION');
  if (TRAILING_CONTINUATION.test(normalizedStatement)) reasons.push('ENDS_AS_CONTINUATION');
  if (NEXT_QUESTION.test(normalizedStatement)) reasons.push('CONTAINS_NEXT_QUESTION');
  if (MULTI_ITEM.test(statement) || MULTI_ITEM_INSTRUCTION.test(normalizedStatement)) reasons.push('MULTI_ITEM_ACTIVITY');
  if (VISUAL_REFERENCE.test(normalizedStatement)) reasons.push('MISSING_VISUAL_EVIDENCE');

  return { valid: reasons.length === 0, reasons, sourceMatch };
}
