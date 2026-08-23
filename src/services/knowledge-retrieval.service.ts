import {
  loadKnowledgeContext,
  searchReadyKnowledgeChunks,
  type KnowledgeSearchInput,
} from '../repositories/knowledge-retrieval.repository.js';

export type KnowledgeCitation = {
  documentId: string;
  blockId: string | null;
  chunkId: string;
  similarity: number;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
  sectionPath: unknown;
};

export class KnowledgeRetrievalService {
  async search(input: KnowledgeSearchInput) {
    const startedAt = Date.now();
    console.log('Busca vetorial de conhecimento iniciada', {
      event: 'monitor.knowledge_retrieval_started',
      teacherId: input.teacherId,
      monitorId: input.monitorId,
      subjectId: input.subjectId,
      topicId: input.topicId ?? null,
      requestedLimit: input.limit ?? 8,
      embeddingDimensions: input.queryEmbedding.length,
    });

    const candidates = await searchReadyKnowledgeChunks(input);
    const uniqueCandidates = candidates.filter((candidate, index, all) => (
      candidate.blockId === null
        || all.findIndex((item) => item.blockId === candidate.blockId) === index
    ));
    const blocks = await loadKnowledgeContext(uniqueCandidates);
    const blockMap = new Map(blocks.map((block) => [block.id, block]));

    const citations: KnowledgeCitation[] = uniqueCandidates.map((candidate) => {
      const block = candidate.blockId ? blockMap.get(candidate.blockId) : undefined;
      return {
        documentId: candidate.documentId,
        blockId: candidate.blockId,
        chunkId: candidate.chunkId,
        similarity: Number(candidate.similarity),
        content: candidate.content,
        pageStart: block?.pageStart ?? null,
        pageEnd: block?.pageEnd ?? null,
        sectionPath: block?.sectionPath ?? null,
      };
    });

    console.log('Busca vetorial de conhecimento concluida', {
      event: 'monitor.knowledge_retrieval_completed',
      candidateCount: candidates.length,
      uniqueBlockCount: uniqueCandidates.length,
      contextBlockCount: blocks.length,
      durationMs: Date.now() - startedAt,
    });

    return {
      citations,
      contextBlocks: blocks,
      candidates,
    };
  }
}
