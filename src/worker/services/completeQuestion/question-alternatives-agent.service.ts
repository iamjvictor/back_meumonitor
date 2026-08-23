import {
  alternativesOnlyJsonSchema,
  alternativesOnlyZodSchema,
} from '../../schemas/question-completion.schema.js';
import { QuestionCompletionRequestService } from './question-completion-request.service.js';
import type { CompletionGeneration, QuestionAgentFailure, QuestionAlternative, QuestionCompletionInput } from './question-completion.types.js';

export class QuestionAlternativesAgentService {
  constructor(private readonly requestService = new QuestionCompletionRequestService()) {}

  async complete(input: QuestionCompletionInput): Promise<{
    alternatives: QuestionAlternative[];
    generated: boolean;
    generation?: CompletionGeneration;
    failure?: QuestionAgentFailure;
  }> {
    const sourceAlternatives = normalizeAlternatives(input.alternatives);
    if (sourceAlternatives.length === 5) {
      return { alternatives: sourceAlternatives, generated: false };
    }

    const response = await this.requestService.request({
      task: 'question_alternatives',
      schema: alternativesOnlyJsonSchema,
      parser: alternativesOnlyZodSchema,
      messages: [
        {
          role: 'system',
          content: 'Crie exatamente cinco alternativas A, B, C, D e E. Preserve o conteudo e a ordem das alternativas documentais, completando somente as faltantes. O campo text de cada alternativa nao pode conter rotulos como "A)", "b)" ou a letra da proxima alternativa, nem cabecalhos/rodapes do documento. Nao inclua explicacao, gabarito ou texto fora do JSON.',
        },
        {
          role: 'user',
          content: `Enunciado:\n${input.statement}\n\nAlternativas documentais:\n${formatAlternatives(sourceAlternatives)}`,
        },
      ],
    });
    if (!response.data) {
      return { alternatives: sourceAlternatives, generated: false, failure: response.failure };
    }

    const alternatives = normalizeAlternatives(response.data.alternatives);
    if (alternatives.length !== 5 || !preservesSourceAlternatives(sourceAlternatives, alternatives)) {
      return {
        alternatives: sourceAlternatives,
        generated: false,
        failure: {
          agent: 'ALTERNATIVES',
          code: 'INVALID_ALTERNATIVES',
          model: response.model,
          attempts: response.attempts,
        },
      };
    }

    return {
      alternatives,
      generated: true,
      generation: {
        generationType: 'ALTERNATIVES',
        model: response.model,
        inputSnapshot: { statement: input.statement, sourceAlternatives },
        outputSnapshot: response.data,
        confidence: 0.8,
      },
    };
  }
}

export function normalizeAlternatives(alternatives: QuestionAlternative[]) {
  const normalized: QuestionAlternative[] = [];
  for (const alternative of alternatives) {
    const text = normalizeAlternativeText(alternative.text);
    if (!text) continue;
    if (normalized.some((item) => item.text.toLowerCase() === text.toLowerCase())) continue;
    normalized.push({ label: String.fromCharCode(65 + normalized.length), text });
    if (normalized.length === 5) break;
  }
  return normalized;
}

function normalizeAlternativeText(value: string) {
  const normalized = value
    .replace(/^\s*(?:alternativa\s*)?[A-E]\s*[).:;-]\s*/i, '')
    // PDF extraction can append the next alternative marker to the previous text.
    .replace(/\s+[A-E]\s*[).]?\s*$/i, '')
    // Repeated headers occasionally leak into the last alternative at page boundaries.
    .replace(/\s+MATEM[ÁA]TICA\s+FINANCEIRA\b.*$/iu, '')
    .replace(/\s+RAZ[ÃA]O,?\s+PROPOR[CÇ][ÃA]O,?\s+REGRAS?\s+DE\s+TR[EÊ]S\b.*$/iu, '')
    .replace(/\s+/g, ' ')
    .trim();

  return removeUppercaseHeaderSuffix(normalized);
}

function removeUppercaseHeaderSuffix(text: string) {
  const match = /\s+([A-ZÁÀÃÂÉÊÍÓÔÕÚÇ]{4,}(?:\s+[A-ZÁÀÃÂÉÊÍÓÔÕÚÇ0-9,.-]{2,}){2,})\s*$/u.exec(text);
  if (!match?.index) return text;

  const prefix = text.slice(0, match.index).trim();
  return /[a-záàãâéêíóôõúç0-9%)]$/u.test(prefix) ? prefix : text;
}

export function formatAlternatives(alternatives: QuestionAlternative[]) {
  return alternatives.length > 0
    ? alternatives.map((alternative) => `${alternative.label}) ${alternative.text}`).join('\n')
    : '(ausentes)';
}

function preservesSourceAlternatives(source: QuestionAlternative[], completed: QuestionAlternative[]) {
  return source.every((alternative) => completed.some((item) => (
    item.text.toLowerCase() === alternative.text.toLowerCase()
  )));
}
