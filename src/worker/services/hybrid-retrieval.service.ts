export type HybridRetrievalCandidate = {
  chunkId: string;
  documentId: string;
  blockId: string | null;
  parentBlockId: string | null;
  chunkIndex: number;
  blockType: string;
  similarity: number;
  lexicalScore: number;
  fusedScore: number | null;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
  sectionPath: unknown;
  isComplete: boolean;
  incompleteReason: string | null;
  reason: string | null;
};

export type KnowledgeContextBlock = {
  id: string;
  documentId: string;
  parentBlockId: string | null;
  blockIndex: number;
  type: string;
  title: string | null;
  normalizedContent: string;
  sectionPath: unknown;
  pageStart: number | null;
  pageEnd: number | null;
  topicLinks: unknown[];
  parent: {
    id: string;
    title: string | null;
    type: string;
    normalizedContent: string;
    sectionPath: unknown;
    pageStart: number | null;
    pageEnd: number | null;
  } | null;
};

export type HybridRetrievalInput = {
  teacherId: string;
  monitorId: string;
  subjectId: string;
  topicId?: string;
  documentId?: string;
  questionDocumentId?: string;
  questionBlockId?: string;
  questionNumber?: string;
  sectionPath?: string[];
  blockTypes?: string[];
  queryText: string;
  queryEmbedding: number[];
  limit?: number;
  supportOnly?: boolean;
  excludeChunkIds?: string[];
  excludedBlockIds?: string[];
};

export type HybridRetrievalMetrics = {
  recallAtK: number;
  precisionAtK: number;
  reciprocalRank: number;
  mrr: number;
  ndcg: number;
  contextPrecision: number;
  contextRecall: number;
  irrelevantEvidenceRate: number;
};

export type HybridRetrievalResult = {
  citations: HybridRetrievalCandidate[];
  contextBlocks: KnowledgeContextBlock[];
  candidates: HybridRetrievalCandidate[];
  metrics: HybridRetrievalMetrics;
};

export type HybridRetrievalDependencies = {
  searchCandidates: (input: HybridRetrievalInput) => Promise<HybridRetrievalCandidate[]>;
  loadKnowledgeContext: (candidates: HybridRetrievalCandidate[]) => Promise<KnowledgeContextBlock[]>;
  searchExplicitSupport?: (input: HybridRetrievalInput) => Promise<HybridRetrievalCandidate[]>;
};

function clampScore(value: number) {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function canonicalizeList(input?: string[]) {
  return Array.from(new Set((input ?? []).map((item) => item.trim()).filter(Boolean)));
}

function canonicalizePath(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => `${item}`.trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split('>').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function matchesSectionPath(candidatePath: unknown, filterPath?: string[]) {
  const expected = canonicalizeList(filterPath);
  if (expected.length === 0) return true;
  const candidate = canonicalizePath(candidatePath);
  if (candidate.length < expected.length) return false;
  return expected.every((segment, index) => candidate[index]?.toLocaleLowerCase() === segment.toLocaleLowerCase());
}

function rankScore(candidate: HybridRetrievalCandidate) {
  const base = (clampScore(candidate.similarity) * 0.6) + (clampScore(candidate.lexicalScore) * 0.4);
  const supportBoost = candidate.reason === 'EXPLICIT_SUPPORT' ? 1.5 : 0;
  const answerKeyBoost = candidate.blockType === 'ANSWER_KEY' ? 0.08 : 0;
  const solutionBoost = candidate.blockType === 'SOLUTION' ? 0.04 : 0;
  return base + supportBoost + answerKeyBoost + solutionBoost;
}

function compareNullableNumbers(left: number | null, right: number | null) {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function compareCandidates(left: HybridRetrievalCandidate, right: HybridRetrievalCandidate) {
  const scoreDiff = rankScore(right) - rankScore(left);
  if (Math.abs(scoreDiff) > 1e-9) return scoreDiff;

  const fusedLeft = left.fusedScore ?? rankScore(left);
  const fusedRight = right.fusedScore ?? rankScore(right);
  const fusedDiff = fusedRight - fusedLeft;
  if (Math.abs(fusedDiff) > 1e-9) return fusedDiff;

  const similarityDiff = right.similarity - left.similarity;
  if (Math.abs(similarityDiff) > 1e-9) return similarityDiff;

  const lexicalDiff = right.lexicalScore - left.lexicalScore;
  if (Math.abs(lexicalDiff) > 1e-9) return lexicalDiff;

  const pageDiff = compareNullableNumbers(left.pageStart, right.pageStart);
  if (pageDiff !== 0) return pageDiff;

  const chunkIndexDiff = left.chunkIndex - right.chunkIndex;
  if (chunkIndexDiff !== 0) return chunkIndexDiff;

  return left.chunkId.localeCompare(right.chunkId);
}

function isExcluded(candidate: HybridRetrievalCandidate, input: HybridRetrievalInput) {
  if (!candidate.isComplete) return true;

  const excludedChunkIds = new Set([
    ...canonicalizeList(input.excludeChunkIds),
    ...(input.questionBlockId ? [] : []),
  ]);
  const excludedBlockIds = new Set([
    ...canonicalizeList(input.excludedBlockIds),
    ...(input.questionBlockId ? [input.questionBlockId] : []),
  ]);
  const canonicalDocumentId = input.documentId ?? input.questionDocumentId ?? null;

  if (excludedChunkIds.has(candidate.chunkId)) return true;
  if (candidate.blockId && excludedBlockIds.has(candidate.blockId)) return true;
  if (canonicalDocumentId && candidate.documentId !== canonicalDocumentId) return true;
  if (!matchesSectionPath(candidate.sectionPath, input.sectionPath)) return true;
  if (input.blockTypes?.length && !input.blockTypes.includes(candidate.blockType)) return true;
  if (input.supportOnly && candidate.blockType === 'QUESTION') return true;
  return false;
}

function uniqueByGroup(candidates: HybridRetrievalCandidate[]) {
  const seen = new Set<string>();
  const result: HybridRetrievalCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.parentBlockId ?? candidate.blockId ?? candidate.chunkId;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function calculateNdcg(returnedIds: string[], relevantIds: Set<string>) {
  if (relevantIds.size === 0 || returnedIds.length === 0) return 0;
  const dcg = returnedIds.reduce((sum, id, index) => {
    const relevance = relevantIds.has(id) ? 1 : 0;
    if (!relevance) return sum;
    return sum + (relevance / Math.log2(index + 2));
  }, 0);
  const idealLength = Math.min(relevantIds.size, returnedIds.length);
  const idcg = Array.from({ length: idealLength }, (_, index) => 1 / Math.log2(index + 2)).reduce((sum, value) => sum + value, 0);
  return idcg === 0 ? 0 : dcg / idcg;
}

export function calculateRetrievalOfflineMetrics(input: {
  expectedChunkIds: string[];
  expectedBlockIds: string[];
  returnedChunkIds: string[];
  returnedBlockIds: string[];
  relevantReturnedChunkIds?: string[];
}): HybridRetrievalMetrics {
  const expectedChunks = new Set(canonicalizeList(input.expectedChunkIds));
  const expectedBlocks = new Set(canonicalizeList(input.expectedBlockIds));
  const returnedBlocks = canonicalizeList(input.returnedBlockIds);
  const returnedChunks = canonicalizeList(input.returnedChunkIds);
  const relevantChunks = new Set(canonicalizeList(input.relevantReturnedChunkIds));

  const matchedBlockCount = returnedBlocks.filter((id) => expectedBlocks.has(id)).length;
  const matchedChunkCount = returnedChunks.filter((id) => expectedChunks.has(id)).length;
  const recallAtK = expectedBlocks.size === 0 ? 0 : matchedBlockCount / expectedBlocks.size;
  const precisionAtK = returnedBlocks.length === 0 ? 0 : matchedBlockCount / returnedBlocks.length;
  const firstRelevantIndex = returnedBlocks.findIndex((id) => expectedBlocks.has(id));
  const reciprocalRank = firstRelevantIndex < 0 ? 0 : 1 / (firstRelevantIndex + 1);
  const ndcg = calculateNdcg(returnedChunks, relevantChunks.size > 0 ? relevantChunks : expectedChunks);

  return {
    recallAtK,
    precisionAtK,
    reciprocalRank,
    mrr: reciprocalRank,
    ndcg,
    contextPrecision: precisionAtK,
    contextRecall: expectedBlocks.size === 0 ? 0 : matchedBlockCount / expectedBlocks.size,
    irrelevantEvidenceRate: returnedBlocks.length === 0 ? 0 : 1 - precisionAtK,
  };
}

export function rankHybridRetrievalCandidates(
  candidates: HybridRetrievalCandidate[],
  input: Pick<HybridRetrievalInput, 'supportOnly' | 'excludeChunkIds' | 'excludedBlockIds' | 'documentId' | 'questionDocumentId' | 'questionBlockId' | 'sectionPath' | 'blockTypes'> & { queryText: string },
) {
  const scored = candidates.map((candidate) => ({
    ...candidate,
    fusedScore: candidate.fusedScore ?? rankScore(candidate),
  }));
  const filtered = scored.filter((candidate) => !isExcluded(candidate, {
    ...input,
    teacherId: '',
    monitorId: '',
    subjectId: '',
    queryEmbedding: [],
  }));

  return uniqueByGroup([...filtered].sort(compareCandidates));
}

export class HybridRetrievalService {
  constructor(private readonly dependencies: HybridRetrievalDependencies) {}

  async search(input: HybridRetrievalInput): Promise<HybridRetrievalResult> {
    const start = Date.now();
    const [explicitSupport, candidates] = await Promise.all([
      this.dependencies.searchExplicitSupport?.(input) ?? Promise.resolve([] as HybridRetrievalCandidate[]),
      this.dependencies.searchCandidates(input),
    ]);

    const ranked = rankHybridRetrievalCandidates(
      [...explicitSupport, ...candidates].map((candidate) => ({
        ...candidate,
        fusedScore: candidate.fusedScore ?? rankScore(candidate),
      })),
      {
        supportOnly: input.supportOnly ?? false,
        excludeChunkIds: input.excludeChunkIds,
        excludedBlockIds: input.excludedBlockIds,
        documentId: input.documentId ?? input.questionDocumentId,
        questionDocumentId: input.questionDocumentId,
        questionBlockId: input.questionBlockId,
        sectionPath: input.sectionPath,
        blockTypes: input.blockTypes,
        queryText: input.queryText,
      },
    ).slice(0, input.limit ?? 8);

    const contextBlocks = await this.dependencies.loadKnowledgeContext(ranked);
    const contextMap = new Map(contextBlocks.map((block) => [block.id, block]));
    const citations = ranked.map((candidate) => {
      const context = candidate.blockId ? contextMap.get(candidate.blockId) : undefined;
      return {
        ...candidate,
        pageStart: context?.pageStart ?? candidate.pageStart,
        pageEnd: context?.pageEnd ?? candidate.pageEnd,
        sectionPath: context?.sectionPath ?? candidate.sectionPath,
      };
    });

    const metrics = calculateRetrievalOfflineMetrics({
      expectedChunkIds: [],
      expectedBlockIds: [],
      returnedChunkIds: citations.map((candidate) => candidate.chunkId),
      returnedBlockIds: citations.map((candidate) => candidate.blockId).filter((id): id is string => Boolean(id)),
      relevantReturnedChunkIds: [],
    });

    console.log('Busca hibrida de conhecimento concluida', {
      event: 'monitor.hybrid_knowledge_retrieval_completed',
      durationMs: Date.now() - start,
      candidateCount: candidates.length + explicitSupport.length,
      rankedCount: ranked.length,
      contextBlockCount: contextBlocks.length,
    });

    return {
      citations,
      contextBlocks,
      candidates: ranked,
      metrics,
    };
  }
}
