import type { QuestionEvidenceResult } from '../models/question-evidence.model.js';

export function buildQuestionEvidenceContext(evidence: QuestionEvidenceResult) {
  const sections = [
    evidence.answer ? `[GABARITO OFICIAL]\n${evidence.answer}` : null,
    evidence.explanation ? `[EXPLICAÇÃO OFICIAL]\n${evidence.explanation}` : null,
    evidence.citations.length > 0
      ? [
          '[FONTES OFICIAIS]',
          evidence.citations.map((citation, index) => [
            `Evidência ${index + 1} (${citation.role})`,
            `Documento: ${citation.documentId}`,
            `Página: ${formatPageRange(citation.pageStart, citation.pageEnd)}`,
            `Confiança: ${citation.confidence ?? 'não informada'}`,
            citation.content,
          ].join('\n')).join('\n\n---\n\n'),
        ].join('\n')
      : null,
  ].filter((section): section is string => Boolean(section));

  return sections.join('\n\n---\n\n');
}

function formatPageRange(start: number | null, end: number | null) {
  if (start === null && end === null) return 'não informada';
  if (start === end || end === null) return `${start}`;
  return `${start}-${end}`;
}
