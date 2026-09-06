import { countTokens } from 'gpt-tokenizer';
import { env } from '../../config/env.js';
import {
  findDocumentBlocksForChunking,
  saveExtractedChunks,
  type DocumentChunkInput,
} from '../../repositories/document-worker.repository.js';

const PARENT_CHUNK_TARGET_TOKENS = env.RAG_PARENT_CHUNK_TARGET_TOKENS;
const PARENT_CHUNK_MAX_TOKENS = env.RAG_PARENT_CHUNK_MAX_TOKENS;
const CHILD_CHUNK_TARGET_TOKENS = env.RAG_CHILD_CHUNK_TARGET_TOKENS;
const CHILD_CHUNK_MAX_TOKENS = env.RAG_CHILD_CHUNK_MAX_TOKENS;
const CHUNK_OVERLAP_TOKENS = env.RAG_CHILD_CHUNK_OVERLAP_TOKENS;
export const DOCUMENT_EMBEDDING_VERSION = 'hierarchical-block-tokenized-v3';
const TOKENIZER_VERSION = 'gpt-tokenizer-cl100k';
const EMBEDDING_MIN_CHARS = env.EMBEDDING_MIN_CHARS;
const EMBEDDING_MIN_TOKENS = env.EMBEDDING_MIN_TOKENS;
export const countChunkTokens = countTokens;
const PARENT_CHUNK_TYPES = new Set(['QUESTION', 'ANSWER_KEY', 'SOLUTION', 'WORKED_EXAMPLE']);
const SHORT_VALID_TYPES = new Set(['QUESTION', 'ANSWER_KEY', 'SOLUTION', 'WORKED_EXAMPLE', 'FORMULA']);

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
  | 'PROMOTIONAL_FRAGMENT'
  | 'STANDALONE_HEADING'
  | 'TRUNCATED_FRAGMENT'
  | 'TOO_SHORT';

export type ChunkEligibility =
  | { eligible: true }
  | { eligible: false; reason: ChunkSkipReason };

export function getInitialChunkStatus(): DocumentChunkInput['status'] {
  return 'EMBEDDING_PENDING';
}

const UNSUPPORTED_BLOCK_TYPES = new Set(['IMAGE_REFERENCE', 'UNKNOWN', 'SECTION', 'SUBSECTION']);
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

function isPromotionalFragment(content: string) {
  const compact = normalizeForInspection(content);
  return /\b(?:clicando\s+aqui|clique\s+aqui|acesse\s+(?:o|a)|canal\s+|videoaula|assista\s+(?:ao|à|a))\b/i.test(compact)
    && compact.length < 220;
}

function isStandaloneHeading(content: string, block: BlockForChunking) {
  const compact = normalizeForInspection(content);
  if (block.type === 'SECTION' || block.type === 'SUBSECTION') return true;
  if (compact.length > 90 || /[.!?:]/.test(compact) || QUESTION_INTENT.test(compact)) return false;
  const words = compact.match(/[A-Za-zÀ-ÿ]{2,}/g) ?? [];
  return words.length > 0 && words.length <= 9;
}

function isTruncatedFragment(content: string, blockType: string) {
  const compact = normalizeForInspection(content);
  if (/\b\d{1,3}[.)]\s*\([^)]{0,30}$/.test(compact)) return true;
  if (blockType === 'QUESTION' && compact.length < 100) {
    const hasQuestionMark = /\?/.test(compact);
    const looksLikeTrailingPedagogicalFragment = /^\s*(?:solu[cç][aã]o|gabarito|resposta|alternativa)\b/i.test(compact);
    return (!hasQuestionMark && /[.)]$/.test(compact) && !QUESTION_INTENT.test(compact)) || looksLikeTrailingPedagogicalFragment;
  }
  if (blockType === 'SOLUTION' && compact.length < 100) {
    const hasReasoning = /[=⇒→]|\b(?:logo|portanto|assim|temos|porque|substituindo|calculando)\b/i.test(compact);
    const looksLikeDirectAnswer = /\b(?:resposta|gabarito|alternativa|valor)\b/i.test(compact)
      || /:\s*[^()\n]{1,40}(?:[.!?])?$/u.test(compact)
      || /(?:^|\s)[A-E]$/u.test(compact);
    return !hasReasoning && !looksLikeDirectAnswer;
  }
  return false;
}

function isPlausibleAnswerKey(content: string) {
  return Array.from(normalizeForInspection(content).matchAll(ANSWER_KEY_ENTRIES)).length > 0;
}

export function getBlockEligibility(block: BlockForChunking): ChunkEligibility {
  const content = normalizeForInspection(block.normalizedContent);
  if (!content) return { eligible: false, reason: 'EMPTY_CONTENT' };
  if (!block.isComplete) {
    if (block.type !== 'QUESTION' || content.length < 20) {
      return { eligible: false, reason: 'INVALID_QUESTION' };
    }

    // Questões incompletas ainda são evidência útil para a montagem do
    // question span e para a reconstrução por IA com blocos vizinhos.
    return { eligible: true };
  }
  if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(content)) return { eligible: false, reason: 'PAGE_MARKER' };
  if (UNSUPPORTED_BLOCK_TYPES.has(block.type)) return { eligible: false, reason: 'UNSUPPORTED_BLOCK_TYPE' };
  if (isTableOfContents(content)) return { eligible: false, reason: 'TABLE_OF_CONTENTS' };
  if (isHeaderOrFooter(content)) return { eligible: false, reason: 'HEADER_OR_FOOTER' };
  if (isPromotionalFragment(content)) return { eligible: false, reason: 'PROMOTIONAL_FRAGMENT' };
  if (isStandaloneHeading(content, block)) return { eligible: false, reason: 'STANDALONE_HEADING' };
  if (isTruncatedFragment(content, block.type)) return { eligible: false, reason: 'TRUNCATED_FRAGMENT' };
  if (isIsolatedAlternative(content)) return { eligible: false, reason: 'ISOLATED_ALTERNATIVE' };
  if (block.type !== 'ANSWER_KEY' && block.type !== 'SOLUTION' && isAnswerKeyFragment(content)) return { eligible: false, reason: 'ANSWER_KEY_FRAGMENT' };
  if (block.type === 'ANSWER_KEY' && !isPlausibleAnswerKey(content)) return { eligible: false, reason: 'ANSWER_KEY_FRAGMENT' };
  if (block.type === 'FORMULA' && isFormulaFragment(content)) return { eligible: false, reason: 'FORMULA_FRAGMENT' };
  if (!SHORT_VALID_TYPES.has(block.type) && content.length < EMBEDDING_MIN_CHARS) return { eligible: false, reason: 'TOO_SHORT' };
  if (!SHORT_VALID_TYPES.has(block.type) && countTokens(content) < EMBEDDING_MIN_TOKENS) return { eligible: false, reason: 'TOO_SHORT' };
  return { eligible: true };
}

export function getChunkEligibility(chunk: ChunkSlice, block: BlockForChunking): ChunkEligibility {
  const content = normalizeForInspection(chunk.content);
  if (!content) return { eligible: false, reason: 'EMPTY_CONTENT' };
  if (!SHORT_VALID_TYPES.has(block.type) && content.length < EMBEDDING_MIN_CHARS) return { eligible: false, reason: 'TOO_SHORT' };
  if (!SHORT_VALID_TYPES.has(block.type) && countTokens(content) < EMBEDDING_MIN_TOKENS) return { eligible: false, reason: 'TOO_SHORT' };
  if (isPromotionalFragment(content)) return { eligible: false, reason: 'PROMOTIONAL_FRAGMENT' };
  if (isTruncatedFragment(content, block.type)) return { eligible: false, reason: 'TRUNCATED_FRAGMENT' };
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

function tokenLimitForBlock(blockType: string) {
  return PARENT_CHUNK_TYPES.has(blockType) ? PARENT_CHUNK_MAX_TOKENS : CHILD_CHUNK_MAX_TOKENS;
}

function splitOversizedUnit(unit: SemanticUnit, blockType: string): SemanticUnit[] {
  const tokenLimit = tokenLimitForBlock(blockType);
  if (countTokens(unit.content) <= tokenLimit) return [unit];

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
      .flatMap((sentence) => splitOversizedUnit(sentence, blockType));
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
      && countTokens(unit.content.slice(wordSpans[wordStart]!.start, wordSpans[wordEnd]!.end)) <= tokenLimit
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

function addSemanticOverlap(slices: SemanticUnit[], blockType: string) {
  const tokenLimit = tokenLimitForBlock(blockType);
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
    while (countTokens(content) > tokenLimit && adjustedStart < slice.charStart) {
      const nextWord = content.search(/\s+/);
      if (nextWord < 0) break;
      content = content.slice(nextWord).trim();
      adjustedStart += nextWord + 1;
    }

    return { content, charStart: adjustedStart, charEnd: slice.charEnd };
  });
}

export function splitBlockContent(content: string, blockType: string) {
  if (blockType === 'QUESTION') {
    const normalized = content.trim();
    return normalized ? [{ content: normalized, charStart: 0, charEnd: content.length }] : [];
  }
  const tokenLimit = tokenLimitForBlock(blockType);
  const units = splitSemanticUnits(content, blockType).flatMap((unit) => splitOversizedUnit(unit, blockType));
  const packed: SemanticUnit[] = [];
  let current: SemanticUnit | null = null;

  for (const unit of units) {
    if (!current) {
      current = { ...unit };
      continue;
    }

    const combined = content.slice(current.charStart, unit.charEnd).trim();
    if (countTokens(combined) <= tokenLimit) {
      current = { ...current, content: combined, charEnd: unit.charEnd };
    } else {
      packed.push(current);
      current = { ...unit };
    }
  }

  if (current) packed.push(current);
  return addSemanticOverlap(packed, blockType);
}

function isUsefulSectionTitle(value: string) {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length < 3 || compact.length > 100) return false;
  if (/^[A-Z]$/i.test(compact) || /[=<>]/.test(compact)) return false;
  const words = compact.match(/[A-Za-zÀ-ÿ]{2,}/g) ?? [];
  const numbers = compact.match(/\b\d+(?:[.,]\d+)?\b/g) ?? [];
  return words.length > 0 && numbers.length <= 2;
}

function sectionPathToText(sectionPath: unknown) {
  if (!Array.isArray(sectionPath)) return '';
  return sectionPath
    .filter((item): item is string => typeof item === 'string' && isUsefulSectionTitle(item))
    .join(' > ');
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
      tokenLimit: PARENT_CHUNK_MAX_TOKENS,
      parentTargetTokens: PARENT_CHUNK_TARGET_TOKENS,
      parentMaxTokens: PARENT_CHUNK_MAX_TOKENS,
      childTargetTokens: CHILD_CHUNK_TARGET_TOKENS,
      childMaxTokens: CHILD_CHUNK_MAX_TOKENS,
      overlapTokens: CHUNK_OVERLAP_TOKENS,
      tokenizerVersion: TOKENIZER_VERSION,
      embeddingVersion: DOCUMENT_EMBEDDING_VERSION,
    });

    const source = await findDocumentBlocksForChunking(documentId, documentTextId);
    const blocks = source.blocks as BlockForChunking[];
    if (blocks.length === 0) throw new Error('Nenhum bloco estrutural disponivel para criar chunks.');

    const chunks: DocumentChunkInput[] = [];
    const skippedBlocksByReason: Partial<Record<ChunkSkipReason, number>> = {};
    const skippedChunksByReason: Partial<Record<ChunkSkipReason, number>> = {};
    let incompleteQuestionBlocksIncluded = 0;
    for (const block of blocks) {
      const blockEligibility = getBlockEligibility(block);
      if (!blockEligibility.eligible) {
        skippedBlocksByReason[blockEligibility.reason] = (skippedBlocksByReason[blockEligibility.reason] ?? 0) + 1;
        continue;
      }

      if (block.type === 'QUESTION' && !block.isComplete) {
        incompleteQuestionBlocksIncluded += 1;
      }

      const blockChunks = splitBlockContent(block.normalizedContent, block.type);
      let persistedChunkIndex = 0;
      blockChunks.forEach((chunk) => {
        const chunkEligibility = getChunkEligibility(chunk, block);
        if (!chunkEligibility.eligible) {
          skippedChunksByReason[chunkEligibility.reason] = (skippedChunksByReason[chunkEligibility.reason] ?? 0) + 1;
          return;
        }

        chunks.push({
          blockId: block.id,
          chunkIndexInBlock: persistedChunkIndex,
          content: chunk.content,
          embeddingContent: block.type === 'ANSWER_KEY' ? null : buildEmbeddingContent(block, chunk.content, {
            documentTitle: source.context.documentTitle,
            subjectName: source.context.subjectName,
          }),
          tokenCount: countTokens(chunk.content),
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
          pageStart: block.pageStart,
          pageEnd: block.pageEnd,
          status: getInitialChunkStatus(),
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
      incompleteQuestionBlocksIncluded,
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

    return { ...chunkResult, blockCount: blocks.length, embeddingVersion: DOCUMENT_EMBEDDING_VERSION, tokenizerVersion: TOKENIZER_VERSION };
  }
}
