import {
  loadKnowledgeContext,
  searchReadyKnowledgeChunks,
  type KnowledgeSearchInput,
} from '../repositories/knowledge-retrieval.repository.js';
import {
  HybridRetrievalService,
  type HybridRetrievalCandidate,
  type HybridRetrievalInput,
  type HybridRetrievalResult,
} from '../worker/services/hybrid-retrieval.service.js';

export class KnowledgeRetrievalService {
  private readonly hybrid = new HybridRetrievalService({
    searchCandidates: async (input: HybridRetrievalInput) => searchReadyKnowledgeChunks(input),
    loadKnowledgeContext: async (candidates: HybridRetrievalCandidate[]) => loadKnowledgeContext(candidates as any),
  });

  async search(input: KnowledgeSearchInput) {
    const startedAt = Date.now();
    console.log('[knowledge-retrieval.service.ts] Busca vetorial de conhecimento iniciada', {
      event: 'monitor.knowledge_retrieval_started',
      teacherId: input.teacherId,
      monitorId: input.monitorId,
      subjectId: input.subjectId,
      topicId: input.topicId ?? null,
      requestedLimit: input.limit ?? 8,
      embeddingDimensions: input.queryEmbedding.length,
    });

    const result = await this.hybrid.search({
      ...input,
      queryText: input.queryText ?? '',
      documentId: input.documentId,
      questionDocumentId: input.documentId,
      questionBlockId: input.questionBlockId,
      sectionPath: input.sectionPath,
      blockTypes: input.blockTypes,
      supportOnly: input.supportOnly,
      excludeChunkIds: input.excludeChunkIds,
      excludedBlockIds: input.excludedBlockIds,
    } as HybridRetrievalInput);

    console.log('[knowledge-retrieval.service.ts] Busca vetorial de conhecimento concluida', {
      event: 'monitor.knowledge_retrieval_completed',
      candidateCount: result.candidates.length,
      uniqueBlockCount: result.citations.length,
      contextBlockCount: result.contextBlocks.length,
      durationMs: Date.now() - startedAt,
    });

    return result as HybridRetrievalResult;
  }
}
