import type { AuthorizedQuestionContext } from '../../models/chat-generation.model.js';
import type { ChatHistoryMessage } from '../../models/chat-history.model.js';
import type { ChatRagResult } from '../models/chat-rag.model.js';

const DEFAULT_MAX_CHARS = 12_000;

export type ChatContextAssemblyInput = {
  message: string;
  history: ChatHistoryMessage[];
  questionContext: AuthorizedQuestionContext | null;
  rag: ChatRagResult;
};

export class ChatContextAssembler {
  constructor(private readonly options: { maxChars?: number } = {}) {}

  assemble(input: ChatContextAssemblyInput) {
    const questionSection = input.questionContext
      ? [
          '[QUESTÃO OFICIAL]',
          `Número: ${input.questionContext.number ?? 'não informado'}`,
          `Tópico: ${input.questionContext.topic ?? 'não informado'}`,
          `Enunciado: ${input.questionContext.statement}`,
          `Alternativas: ${input.questionContext.options.map((option) => `${option.label}) ${option.text}`).join('; ') || 'nenhuma'}`,
          `Alternativa selecionada: ${input.questionContext.selectedOption ?? 'nenhuma'}`,
        ].join('\n')
      : '[QUESTÃO OFICIAL]\nNenhuma questão foi anexada.';
    const history = input.history.slice(-6);
    const historySection = history.length > 0
      ? [
          '[HISTÓRICO RELEVANTE]',
          ...history.map((message) => `${message.role === 'assistant' ? 'Tutor' : 'Aluno'}: ${message.content}`),
        ].join('\n')
      : '[HISTÓRICO RELEVANTE]\nNenhuma mensagem anterior.';
    const evidenceSection = formatEvidence(input.rag);
    const currentSection = `[DÚVIDA ATUAL DO ALUNO]\n${input.message.trim()}`;
    const baseSections = hasOfficialEvidenceMarker(input.rag.context)
      ? [evidenceSection, questionSection, historySection]
      : [questionSection, historySection, evidenceSection];
    const base = baseSections.join('\n\n');
    const maxChars = this.options.maxChars ?? DEFAULT_MAX_CHARS;
    const availableBaseChars = Math.max(0, maxChars - currentSection.length - 2);
    const assembled = `${base.slice(0, availableBaseChars)}\n\n${currentSection}`;

    return assembled.length <= maxChars ? assembled : assembled.slice(-maxChars);
  }
}

function formatEvidence(rag: ChatRagResult) {
  if (!rag.used || rag.citations.length === 0) {
    if (rag.used && rag.context.trim() && hasOfficialEvidenceMarker(rag.context)) {
      return `[EVIDÊNCIAS RECUPERADAS]\n${rag.context}`;
    }
    return '[EVIDÊNCIAS RECUPERADAS]\nNenhuma evidência relevante foi recuperada.';
  }

  if (hasOfficialEvidenceMarker(rag.context)) {
    return `[EVIDÊNCIAS RECUPERADAS]\n${rag.context}`;
  }

  const seen = new Set<string>();
  const evidence = rag.citations.flatMap((citation) => {
    const key = citation.blockId ?? citation.chunkId;
    if (seen.has(key)) return [];
    seen.add(key);
    return [[
      `Evidência ${seen.size}`,
      `Documento: ${citation.documentId}`,
      `Página: ${formatPageRange(citation.pageStart, citation.pageEnd)}`,
      citation.content,
    ].join('\n')];
  });

  return evidence.length > 0
    ? `[EVIDÊNCIAS RECUPERADAS]\n${evidence.join('\n\n---\n\n')}`
    : '[EVIDÊNCIAS RECUPERADAS]\nNenhuma evidência relevante foi recuperada.';
}

function hasOfficialEvidenceMarker(context: string) {
  return context.includes('[GABARITO OFICIAL]')
    || context.includes('[FLASHCARD OFICIAL]');
}

function formatPageRange(start: number | null, end: number | null) {
  if (start === null && end === null) return 'não informada';
  if (start === end || end === null) return `${start}`;
  return `${start}-${end}`;
}
