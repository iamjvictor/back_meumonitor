import { countTokens } from 'gpt-tokenizer';
import {
  findDocumentBlocksForChunking,
  saveExtractedChunks,
  type DocumentChunkInput,
} from '../../repositories/document-worker.repository.js';

const CHUNK_TOKEN_LIMIT = 600;
const CHUNK_OVERLAP_TOKENS = 100;
const EMBEDDING_VERSION = 'hierarchical-block-tokenized-v2';
const TOKENIZER_VERSION = 'gpt-tokenizer-cl100k';
const MIN_RETRIEVAL_CHUNK_CHARS = 24;

export type BlockForChunking = {
  id: string;
  blockIndex: number;
  type: string;
  title: string | null;
  normalizedContent: string;
  isComplete: boolean;
  incompleteReason: string | null;
  sectionPath: unknown;
  questionNumber: string | null;
  institution: string | null;
  examYear: number | null;
  pageStart: number | null;
  pageEnd: number | null;
  topicLinks: Array<{
    topic: { id: string; name: string };
    confidence: number | null;
    isPrimary: boolean;
  }>;
};

type ChunkSlice = {
  content: string;
  charStart: number;
  charEnd: number;
};

type SemanticUnit = ChunkSlice;

type ChunkSkipReason =
  | 'EMPTY_CONTENT'
  | 'PAGE_MARKER'
  | 'TABLE_OF_CONTENTS'
  | 'HEADER_OR_FOOTER'
  | 'UNSUPPORTED_BLOCK_TYPE'
  | 'ISOLATED_ALTERNATIVE'
  | 'ANSWER_KEY_FRAGMENT'
  | 'INVALID_QUESTION'
  | 'FORMULA_FRAGMENT'
  | 'TOO_SHORT';

export type ChunkEligibility =
  | { eligible: true }
  | { eligible: false; reason: ChunkSkipReason };

const UNSUPPORTED_BLOCK_TYPES = new Set(['IMAGE_REFERENCE', 'UNKNOWN']);
const QUESTION_INTENT = /\?|\b(?:calcule|determine|encontre|resolva|assinale|marque|indique|qual(?:\s+e|\s+é)?|quanto|sabe-se|considere|uma?\s+(?:empresa|pessoa|loja|turma|máquina|grupo)|sejam?)\b/i;
const ANSWER_KEY_ENTRIES = /(?:^|\s)\d{1,3}\s*[.)-]\s*(?:\[?[A-H]\]?|r?\$?\s*[\d.,]+%?)(?=\s|$)/gim;

function normalizeForInspection(content: string) {
  return content
    .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isTableOfContents(content: string) {
  const compact = normalizeForInspection(content);
  return /^(?:sum[aá]rio|conte[uú]do)\b/i.test(compact)
    || /(?:(?:\.\s*){3,}|…{2,})\s*\d{1,4}\s*(?:\n|$)/.test(compact);
}

function isHeaderOrFooter(content: string) {
  const compact = normalizeForInspection(content);
  return /^(?:p[aá]gina\s*)?\d{1,4}\s*(?:de|\/)\s*\d{1,4}$/i.test(compact)
    || /^\d{1,4}$/.test(compact)
    || /^(?:material|apostila|curso)\b.{0,80}(?:p[aá]gina\s*)?\d{1,4}$/i.test(compact);
}

function isIsolatedAlternative(content: string) {
  const compact = normalizeForInspection(content);
  return /^(?:[A-H][.)]|[A-H][\]])\s*.+/i.test(compact)
    && !QUESTION_INTENT.test(compact)
    && compact.length < 180;
}

function isAnswerKeyFragment(content: string) {
  const compact = normalizeForInspection(content);
  const entries = Array.from(compact.matchAll(ANSWER_KEY_ENTRIES));
  const wordCount = compact.match(/[A-Za-zÀ-ÿ]{3,}/g)?.length ?? 0;
  return entries.length >= 2
    && compact.length < 320
    && wordCount < 25
    && !QUESTION_INTENT.test(compact);
}

function isFormulaFragment(content: string) {
  const compact = normalizeForInspection(content);
  const words = compact.match(/[A-Za-zÀ-ÿ]{3,}/g)?.length ?? 0;
  const symbols = compact.match(/[=+*/^%]|[\d]/g)?.length ?? 0;
  return words < 3 && symbols >= 4;
}

function isPlausibleAnswerKey(content: string) {
  return Array.from(normalizeForInspection(content).matchAll(ANSWER_KEY_ENTRIES)).length > 0;
}

export function getBlockEligibility(block: BlockForChunking): ChunkEligibility {
  const content = normalizeForInspection(block.normalizedContent);
  if (!content) return { eligible: false, reason: 'EMPTY_CONTENT' };
  if (!block.isComplete) return { eligible: false, reason: 'INVALID_QUESTION' };
  if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(content)) return { eligible: false, reason: 'PAGE_MARKER' };
  if (UNSUPPORTED_BLOCK_TYPES.has(block.type)) return { eligible: false, reason: 'UNSUPPORTED_BLOCK_TYPE' };
  if (isTableOfContents(content)) return { eligible: false, reason: 'TABLE_OF_CONTENTS' };
  if (isHeaderOrFooter(content)) return { eligible: false, reason: 'HEADER_OR_FOOTER' };
  if (isIsolatedAlternative(content)) return { eligible: false, reason: 'ISOLATED_ALTERNATIVE' };
  if (block.type !== 'ANSWER_KEY' && block.type !== 'SOLUTION' && isAnswerKeyFragment(content)) return { eligible: false, reason: 'ANSWER_KEY_FRAGMENT' };
  if (block.type === 'ANSWER_KEY' && !isPlausibleAnswerKey(content)) return { eligible: false, reason: 'ANSWER_KEY_FRAGMENT' };
  if (block.type === 'FORMULA' && isFormulaFragment(content)) return { eligible: false, reason: 'FORMULA_FRAGMENT' };
  if (block.type !== 'ANSWER_KEY' && content.length < MIN_RETRIEVAL_CHUNK_CHARS) return { eligible: false, reason: 'TOO_SHORT' };
  return { eligible: true };
}

export function getChunkEligibility(chunk: ChunkSlice, block: BlockForChunking): ChunkEligibility {
  const content = normalizeForInspection(chunk.content);
  if (!content) return { eligible: false, reason: 'EMPTY_CONTENT' };
  if (block.type !== 'ANSWER_KEY' && content.length < MIN_RETRIEVAL_CHUNK_CHARS) return { eligible: false, reason: 'TOO_SHORT' };
  if (block.type !== 'QUESTION' && isIsolatedAlternative(content)) return { eligible: false, reason: 'ISOLATED_ALTERNATIVE' };
  if (block.type !== 'ANSWER_KEY' && block.type !== 'SOLUTION' && isAnswerKeyFragment(content)) return { eligible: false, reason: 'ANSWER_KEY_FRAGMENT' };
  return { eligible: true };
}

function splitSemanticUnits(content: string, blockType: string): SemanticUnit[] {
  const starts = [0];
  const boundaryPattern = blockType === 'QUESTION'
    ? /^\s*(?=[A-Ea-e][).]\s|(?:resolu[cç][aã]o|solu[cç][aã]o|gabarito)\b)/gim
    : blockType === 'TABLE' || blockType === 'LIST' || blockType === 'ANSWER_KEY'
      ? /\n(?=\S)/g
    : /\n\s*\n/g;

  for (const match of content.matchAll(boundaryPattern)) {
    const index = match.index ?? 0;
    if (index > 0 && index < content.length) starts.push(index);
  }

  const uniqueStarts = Array.from(new Set(starts)).sort((left, right) => left - right);
  return uniqueStarts.map((start, index) => {
    const end = uniqueStarts[index + 1] ?? content.length;
    return { content: content.slice(start, end).trim(), charStart: start, charEnd: end };
  }).filter((unit) => unit.content.length > 0);
}

function splitOversizedUnit(unit: SemanticUnit): SemanticUnit[] {
  if (countTokens(unit.content) <= CHUNK_TOKEN_LIMIT) return [unit];

  const sentenceSpans = Array.from(unit.content.matchAll(/[^.!?\n]+(?:[.!?]+(?=\s|$)|$)/g)).map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
  if (sentenceSpans.length > 1) {
    return sentenceSpans
      .map((span) => ({
        content: unit.content.slice(span.start, span.end).trim(),
        charStart: unit.charStart + span.start,
        charEnd: unit.charStart + span.end,
      }))
      .filter((sentence) => sentence.content.length > 0)
      .flatMap(splitOversizedUnit);
  }

  const wordSpans = Array.from(unit.content.matchAll(/\S+/g)).map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
  const pieces: SemanticUnit[] = [];
  let wordStart = 0;

  while (wordStart < wordSpans.length) {
    let wordEnd = wordStart + 1;
    while (
      wordEnd < wordSpans.length
      && countTokens(unit.content.slice(wordSpans[wordStart]!.start, wordSpans[wordEnd]!.end)) <= CHUNK_TOKEN_LIMIT
    ) {
      wordEnd += 1;
    }

    const lastWord = wordSpans[Math.max(wordStart, wordEnd - 1)]!;
    const start = wordSpans[wordStart]!.start;
    const end = lastWord.end;
    pieces.push({
      content: unit.content.slice(start, end),
      charStart: unit.charStart + start,
      charEnd: unit.charStart + end,
    });

    if (wordEnd >= wordSpans.length) break;

    let overlapStart = wordEnd - 1;
    while (
      overlapStart > wordStart
      && countTokens(unit.content.slice(wordSpans[overlapStart]!.start, end)) <= CHUNK_OVERLAP_TOKENS
    ) {
      overlapStart -= 1;
    }
    wordStart = Math.max(wordEnd - 1, overlapStart + 1);
  }

  return pieces;
}

function addSemanticOverlap(slices: SemanticUnit[]) {
  return slices.map((slice, index) => {
    if (index === 0) return slice;

    const previous = slices[index - 1]!;
    let overlapStart = previous.charEnd;
    const previousText = previous.content;
    const words = Array.from(previousText.matchAll(/\S+/g));

    for (let wordIndex = words.length - 1; wordIndex >= 0; wordIndex -= 1) {
      const candidateStart = previous.charEnd - (previousText.length - (words[wordIndex]!.index ?? 0));
      const candidate = previousText.slice(words[wordIndex]!.index ?? 0);
      if (countTokens(candidate) > CHUNK_OVERLAP_TOKENS) break;
      overlapStart = candidateStart;
    }

    let content = `${previousText.slice(Math.max(0, overlapStart - previous.charStart))} ${slice.content}`.trim();
    let adjustedStart = overlapStart;
    while (countTokens(content) > CHUNK_TOKEN_LIMIT && adjustedStart < slice.charStart) {
      const nextWord = content.search(/\s+/);
      if (nextWord < 0) break;
      content = content.slice(nextWord).trim();
      adjustedStart += nextWord + 1;
    }

    return { content, charStart: adjustedStart, charEnd: slice.charEnd };
  });
}

export function splitBlockContent(content: string, blockType: string) {
  const units = splitSemanticUnits(content, blockType).flatMap(splitOversizedUnit);
  const packed: SemanticUnit[] = [];
  let current: SemanticUnit | null = null;

  for (const unit of units) {
    if (!current) {
      current = { ...unit };
      continue;
    }

    const combined = content.slice(current.charStart, unit.charEnd).trim();
    if (countTokens(combined) <= CHUNK_TOKEN_LIMIT) {
      current = { ...current, content: combined, charEnd: unit.charEnd };
    } else {
      packed.push(current);
      current = { ...unit };
    }
  }

  if (current) packed.push(current);
  return addSemanticOverlap(packed);
}

function sectionPathToText(sectionPath: unknown) {
  if (!Array.isArray(sectionPath)) return '';
  return sectionPath.filter((item): item is string => typeof item === 'string').join(' > ');
}

export function buildEmbeddingContent(
  block: BlockForChunking,
  content: string,
  context: { documentTitle: string | null; subjectName: string | null },
) {
  const lines = [
    context.subjectName ? `Materia: ${context.subjectName}` : null,
    context.documentTitle ? `Documento: ${context.documentTitle}` : null,
    sectionPathToText(block.sectionPath) ? `Secao: ${sectionPathToText(block.sectionPath)}` : null,
    `Tipo: ${block.type}`,
    block.pageStart
      ? `Paginas: ${block.pageStart}${block.pageEnd && block.pageEnd !== block.pageStart ? `-${block.pageEnd}` : ''}`
      : null,
    block.topicLinks.length > 0
      ? `Topicos classificados: ${block.topicLinks.map((link) => link.topic.name).join(', ')}`
      : null,
    block.questionNumber ? `Questao: ${block.questionNumber}` : null,
    block.institution ? `Instituicao: ${block.institution}` : null,
    block.examYear ? `Ano: ${block.examYear}` : null,
  ].filter(Boolean);

  return `${lines.join('\n')}\n\n${content}`;
}

export class ChunkService {
  async processDocument(documentId: string, documentTextId: string) {
    const startedAt = Date.now();
    console.log('Iniciando chunking semantico por blocos', {
      event: 'monitor.document_chunks_started',
      documentId,
      documentTextId,
      tokenLimit: CHUNK_TOKEN_LIMIT,
      overlapTokens: CHUNK_OVERLAP_TOKENS,
      tokenizerVersion: TOKENIZER_VERSION,
      embeddingVersion: EMBEDDING_VERSION,
    });

    const source = await findDocumentBlocksForChunking(documentId, documentTextId);
    const blocks = source.blocks as BlockForChunking[];
    if (blocks.length === 0) throw new Error('Nenhum bloco estrutural disponivel para criar chunks.');

    const chunks: DocumentChunkInput[] = [];
    const skippedBlocksByReason: Partial<Record<ChunkSkipReason, number>> = {};
    const skippedChunksByReason: Partial<Record<ChunkSkipReason, number>> = {};
    for (const block of blocks) {
      const blockEligibility = getBlockEligibility(block);
      if (!blockEligibility.eligible) {
        skippedBlocksByReason[blockEligibility.reason] = (skippedBlocksByReason[blockEligibility.reason] ?? 0) + 1;
        continue;
      }

      const blockChunks = splitBlockContent(block.normalizedContent, block.type);
      let persistedChunkIndex = 0;
      blockChunks.forEach((chunk) => {
        const chunkEligibility = getChunkEligibility(chunk, block);
        if (!chunkEligibility.eligible) {
          skippedChunksByReason[chunkEligibility.reason] = (skippedChunksByReason[chunkEligibility.reason] ?? 0) + 1;
          return;
        }

        const isAnswerKey = block.type === 'ANSWER_KEY';
        chunks.push({
          blockId: block.id,
          chunkIndexInBlock: persistedChunkIndex,
          content: chunk.content,
          embeddingContent: isAnswerKey ? null : buildEmbeddingContent(block, chunk.content, {
            documentTitle: source.context.documentTitle,
            subjectName: source.context.subjectName,
          }),
          tokenCount: countTokens(chunk.content),
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
          pageStart: block.pageStart,
          pageEnd: block.pageEnd,
          status: isAnswerKey ? 'READY' : 'EMBEDDING_PENDING',
        });
        persistedChunkIndex += 1;
      });
    }

    if (chunks.length === 0) {
      throw new Error('Nenhum chunk recuperavel foi produzido apos a validacao de qualidade.');
    }

    console.log('Blocos divididos em chunks semanticos', {
      event: 'monitor.document_chunks_split_completed',
      documentId,
      documentTextId,
      blockCount: blocks.length,
      chunkCount: chunks.length,
      maxTokenCount: Math.max(...chunks.map((chunk) => chunk.tokenCount), 0),
      answerKeyChunks: chunks.filter((chunk) => chunk.embeddingContent === null).length,
      skippedBlockCount: Object.values(skippedBlocksByReason).reduce((total, count) => total + count, 0),
      skippedBlocksByReason,
      skippedChunkCount: Object.values(skippedChunksByReason).reduce((total, count) => total + count, 0),
      skippedChunksByReason,
      tokenizerVersion: TOKENIZER_VERSION,
    });

    const chunkResult = await saveExtractedChunks(documentId, chunks);
    console.log('Chunks semanticos salvos', {
      event: 'monitor.document_chunks_created',
      documentId,
      documentTextId,
      blockCount: blocks.length,
      chunkCount: chunkResult.chunkCount,
      topicCount: chunkResult.topicCount,
      embeddingStatus: 'EMBEDDING_PENDING',
      durationMs: Date.now() - startedAt,
    });

    return { ...chunkResult, blockCount: blocks.length, embeddingVersion: EMBEDDING_VERSION, tokenizerVersion: TOKENIZER_VERSION };
  }
}
