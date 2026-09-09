import type { FlashcardEvidenceResult } from '../models/flashcard-evidence.model.js';

export function buildFlashcardEvidenceContext(evidence: FlashcardEvidenceResult) {
  const sections = [
    '[FLASHCARD OFICIAL]',
    `Frente: ${evidence.front}`,
    `Verso: ${evidence.back}`,
    evidence.citations.length > 0
      ? [
          '[FONTES DO FLASHCARD]',
          evidence.citations.map((citation, index) => [
            `Evidência ${index + 1}`,
            `Documento: ${citation.documentId}`,
            `Página: ${formatPageRange(citation.pageStart, citation.pageEnd)}`,
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
