import type { ExtractionChunk } from './question-extraction.service.js';
import type { QuestionContextAgent, QuestionContextPack } from './question-context-pack.service.js';

const NEXT_QUESTION_MARKER = /\n\s*(?:quest[aã]o\s*)?\d{1,3}[.)]\s+(?=[A-ZÀ-Ý(])/iu;

function compact(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Keeps the RAG context focused when a PDF page contains several questions
 * in the same structural block. The parser may split the block into multiple
 * candidates, but the underlying chunk still contains the whole page.
 */
export function buildFocusedQuestionSourceContext(
  questionText: string,
  chunks: Array<Pick<ExtractionChunk, 'content'>>,
  maxChars = 18_000,
) {
  return chunks.map((chunk) => focusChunk(questionText, chunk.content)).join('\n\n---\n\n').slice(0, maxChars);
}

export function buildQuestionSourceEvidence(
  questionText: string,
  sourceChunks: Array<Pick<ExtractionChunk, 'chunkIndex' | 'content'>>,
  allChunks: Array<Pick<ExtractionChunk, 'chunkIndex' | 'content'>>,
  neighborCount = 1,
  maxChars = 18_000,
) {
  const ordered = [...allChunks].sort((left, right) => left.chunkIndex - right.chunkIndex);
  const sourceIndexes = new Set(sourceChunks.map((chunk) => chunk.chunkIndex));
  const sourcePositions = ordered
    .map((chunk, index) => sourceIndexes.has(chunk.chunkIndex) ? index : -1)
    .filter((index) => index >= 0);
  if (sourcePositions.length === 0) {
    return buildFocusedQuestionSourceContext(questionText, sourceChunks, maxChars);
  }

  const start = Math.max(0, Math.min(...sourcePositions) - neighborCount);
  const end = Math.min(ordered.length - 1, Math.max(...sourcePositions) + neighborCount);
  return ordered.slice(start, end + 1).map((chunk) => {
    const isSource = sourceIndexes.has(chunk.chunkIndex);
    const sourceMax = Math.max(...sourceIndexes);
    const sourceMin = Math.min(...sourceIndexes);
    const label = isSource
      ? 'CHUNK PRINCIPAL'
      : chunk.chunkIndex > sourceMax ? 'PRÓXIMA QUESTÃO' : chunk.chunkIndex < sourceMin ? 'CHUNK ANTERIOR' : 'CHUNK VIZINHO';
    return `[${label} ${chunk.chunkIndex}]\n${isSource ? focusChunkForEvidence(questionText, chunk.content) : chunk.content}`;
  }).join('\n\n---\n\n').slice(0, maxChars);
}

function focusChunkForEvidence(questionText: string, source: string) {
  const firstLine = questionText.split('\n').map((line) => line.trim()).find(Boolean);
  if (!firstLine) return source;
  const start = source.toLocaleLowerCase().indexOf(firstLine.toLocaleLowerCase());
  return start >= 0 ? source.slice(Math.max(0, start - 80)).trim() : source;
}

function focusChunk(questionText: string, source: string) {
  const firstLine = questionText.split('\n').map((line) => line.trim()).find(Boolean) ?? questionText;
  const needle = compact(firstLine);
  const compactSource = compact(source);
  const compactIndex = needle.length >= 12 ? compactSource.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase()) : -1;

  // Prefer an exact line match so the cut preserves the original equations
  // and line breaks. The compact fallback covers normalization differences.
  let start = source.toLocaleLowerCase().indexOf(firstLine.toLocaleLowerCase());
  if (start < 0 && compactIndex >= 0) start = 0;
  if (start < 0) return source;

  const remainder = source.slice(start + Math.max(firstLine.length, 1));
  const nextMarker = remainder.search(NEXT_QUESTION_MARKER);
  const end = nextMarker >= 0
    ? start + Math.max(firstLine.length, 1) + nextMarker
    : source.length;
  return source.slice(Math.max(0, start - 80), end).trim();
}

export function renderQuestionContextPack(pack: QuestionContextPack, agent: QuestionContextAgent) {
  const sections: string[] = [];
  const includeAnswerKey = agent === 'CORRECT_ANSWER' || agent === 'EXPLANATION' || agent === 'AUDIT';
  const includeSolution = agent === 'CORRECT_ANSWER' || agent === 'EXPLANATION' || agent === 'AUDIT';
  const includeConceptSupport = agent !== 'RECONSTRUCTION' || pack.conceptSupport.length > 0;
  const includeVisuals = true;

  sections.push(renderQuestionSourceSection(pack));

  if (includeAnswerKey && pack.answerKeySource) {
    sections.push(renderAnswerKeySourceSection(pack.answerKeySource));
  }

  if (includeSolution && pack.solutionSource) {
    sections.push(renderSolutionSourceSection(pack.solutionSource));
  }

  if (includeConceptSupport && pack.conceptSupport.length > 0) {
    sections.push(renderConceptSupportSection(pack.conceptSupport));
  }

  if (includeVisuals && pack.visuals.length > 0) {
    sections.push(renderVisualSection(pack.visuals));
  }

  sections.push(renderQualitySection(pack.quality));
  return sections.filter(Boolean).join('\n\n---\n\n').trim();
}

function renderQuestionSourceSection(pack: QuestionContextPack) {
  const alternatives = pack.questionSource.alternatives.length > 0
    ? pack.questionSource.alternatives.map((alternative) => `${alternative.label}) ${alternative.text}`).join('\n')
    : '(ausentes)';

  return [
    'QUESTION SOURCE',
    `Document: ${pack.documentId}`,
    `QuestionSpan: ${pack.questionSpanId}`,
    `Statement:\n${pack.questionSource.statement}`,
    `Alternatives:\n${alternatives}`,
    `Source elements: ${pack.questionSource.sourceElementIds.join(', ') || '(none)'}`,
    `Source chunks: ${pack.questionSource.sourceChunkIds.join(', ') || '(none)'}`,
  ].join('\n');
}

function renderAnswerKeySourceSection(answerKeySource: NonNullable<QuestionContextPack['answerKeySource']>) {
  return [
    'ANSWER KEY SOURCE',
    `Answer: ${answerKeySource.answer}`,
    `Confidence: ${answerKeySource.confidence}`,
    `Source elements: ${answerKeySource.sourceElementIds.join(', ') || '(none)'}`,
    `Source chunks: ${(answerKeySource.sourceChunkIds ?? []).join(', ') || '(none)'}`,
  ].join('\n');
}

function renderSolutionSourceSection(solutionSource: NonNullable<QuestionContextPack['solutionSource']>) {
  return [
    'SOLUTION SOURCE',
    `Confidence: ${solutionSource.confidence}`,
    `Content:\n${solutionSource.content}`,
    `Source elements: ${solutionSource.sourceElementIds.join(', ') || '(none)'}`,
    `Source chunks: ${(solutionSource.sourceChunkIds ?? []).join(', ') || '(none)'}`,
  ].join('\n');
}

function renderConceptSupportSection(conceptSupport: QuestionContextPack['conceptSupport']) {
  return [
    'CONCEPT SUPPORT',
    ...conceptSupport.map((item, index) => [
      `Support ${index + 1}`,
      `Block: ${item.sourceBlockId}`,
      `Chunk: ${item.sourceChunkId}`,
      `Score: ${item.relevanceScore}`,
      `Content:\n${item.content}`,
    ].join('\n')),
  ].join('\n');
}

function renderVisualSection(visuals: QuestionContextPack['visuals']) {
  return [
    'VISUALS',
    ...visuals.map((visual, index) => [
      `Visual ${index + 1}`,
      `Asset: ${visual.assetId}`,
      `Type: ${visual.type}`,
      `Page: ${visual.pageNumber}`,
      `BBox: ${JSON.stringify(visual.bbox)}`,
      visual.description ? `Description: ${visual.description}` : null,
    ].filter(Boolean).join('\n')),
  ].join('\n');
}

function renderQualitySection(quality: QuestionContextPack['quality']) {
  return [
    'QUALITY',
    `Structural status: ${quality.structuralStatus}`,
    `Math layout status: ${quality.mathLayoutStatus}`,
    `Warnings: ${quality.warnings.join(', ') || '(none)'}`,
  ].join('\n');
}
