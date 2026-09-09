import type { OpenRouterClient } from '../../../../worker/client/openrouter.client.js';
import type { KnowledgeSearchInput } from '../../../../repositories/knowledge-retrieval.repository.js';
import type { KnowledgeRetrievalService } from '../../../../services/knowledge-retrieval.service.js';
import type { ChatKnowledgePort } from '../ports/chat-knowledge.port.js';
import type { ChatRagInput, ChatRagResult } from '../models/chat-rag.model.js';
import { ChatQueryBuilder } from '../services/chat-query.builder.js';

type EmbeddingPort = Pick<OpenRouterClient, 'createEmbeddings'>;
type RetrievalPort = Pick<KnowledgeRetrievalService, 'search'>;

const RETRIEVAL_LIMIT = 8;
export const SEMANTIC_EMBEDDING_TIMEOUT_MS = 2_000;

export class KnowledgeRetrievalChatProvider implements ChatKnowledgePort {
  constructor(
    private readonly embeddings: EmbeddingPort,
    private readonly retrieval: RetrievalPort,
    private readonly queryBuilder = new ChatQueryBuilder(),
  ) {}

  async retrieve(input: ChatRagInput): Promise<ChatRagResult> {
    const startedAt = Date.now();
    const builtQuery = this.queryBuilder.build(input);
    const baseResult = {
      retrievalQuery: builtQuery.query,
      context: '',
      citations: [],
    };

    console.log('[knowledge-retrieval-chat.provider.ts] [Chat RAG] Recuperação iniciada', {
      event: 'chat.rag_started',
      requestId: input.requestId ?? null,
      studentId: input.studentId,
      teacherId: input.teacherId,
      monitorId: input.monitorId,
      subjectId: input.subjectId,
      topicId: input.topicId,
      questionDocumentId: input.questionDocumentId ?? null,
      questionBlockId: input.questionBlockId ?? null,
      questionId: input.questionContext?.questionId ?? null,
      historyCount: builtQuery.history.length,
    });
    console.log('[knowledge-retrieval-chat.provider.ts] [Chat RAG] Consulta construída', {
      event: 'chat.rag_query_built',
      requestId: input.requestId ?? null,
      queryChars: builtQuery.query.length,
      historyCount: builtQuery.history.length,
      hasQuestionContext: Boolean(input.questionContext),
    });
    console.log('[knowledge-retrieval-chat.provider.ts] [Chat RAG] Embedding semântico iniciado', {
      event: 'chat.rag_embedding_started',
      requestId: input.requestId ?? null,
      queryChars: builtQuery.query.length,
      timeoutMs: SEMANTIC_EMBEDDING_TIMEOUT_MS,
    });

    try {
      const [queryEmbedding] = await this.embeddings.createEmbeddings([builtQuery.query], {
        timeoutMs: SEMANTIC_EMBEDDING_TIMEOUT_MS,
      });
      if (!queryEmbedding || queryEmbedding.length === 0) {
        return this.fallback(baseResult, startedAt, 'EMPTY_EMBEDDING', input.requestId);
      }

      console.log('[knowledge-retrieval-chat.provider.ts] [Chat RAG] Embedding da consulta concluído', {
        event: 'chat.rag_embedding_completed',
        requestId: input.requestId ?? null,
        dimensions: queryEmbedding.length,
        durationMs: Date.now() - startedAt,
      });

      const retrievalInput: KnowledgeSearchInput = {
        teacherId: input.teacherId,
        monitorId: input.monitorId,
        subjectId: input.subjectId,
        topicId: input.topicId ?? undefined,
        questionDocumentId: input.questionDocumentId ?? undefined,
        questionBlockId: input.questionBlockId ?? undefined,
        queryText: builtQuery.query,
        queryEmbedding,
        limit: RETRIEVAL_LIMIT,
      };
      const retrievalResult = await this.retrieval.search(retrievalInput);
      const citations = retrievalResult.citations.map((candidate) => ({
        chunkId: candidate.chunkId,
        documentId: candidate.documentId,
        blockId: candidate.blockId,
        pageStart: candidate.pageStart,
        pageEnd: candidate.pageEnd,
        score: candidate.fusedScore ?? candidate.similarity,
        content: candidate.content,
      }));
      const context = citations
        .map((citation, index) => [
          `Evidência ${index + 1}`,
          `Documento: ${citation.documentId}`,
          `Página: ${formatPageRange(citation.pageStart, citation.pageEnd)}`,
          citation.content,
        ].join('\n'))
        .join('\n\n---\n\n');
      const scores = citations.map((citation) => citation.score);

      console.log('[knowledge-retrieval-chat.provider.ts] [Chat RAG] Retrieval concluído', {
        event: 'chat.rag_retrieval_completed',
        requestId: input.requestId ?? null,
        candidateCount: retrievalResult.candidates.length,
        selectedCount: citations.length,
        scoreAverage: average(scores),
        scoreMin: scores.length > 0 ? Math.min(...scores) : null,
        scoreMax: scores.length > 0 ? Math.max(...scores) : null,
        durationMs: Date.now() - startedAt,
      });

      return {
        used: citations.length > 0,
        retrievalQuery: builtQuery.query,
        context,
        citations,
        metrics: {
          candidateCount: retrievalResult.candidates.length,
          selectedCount: citations.length,
          durationMs: Date.now() - startedAt,
          scoreAverage: average(scores),
          scoreMin: scores.length > 0 ? Math.min(...scores) : null,
          scoreMax: scores.length > 0 ? Math.max(...scores) : null,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'EMBEDDING_TIMEOUT') {
        console.log('[knowledge-retrieval-chat.provider.ts] [Chat RAG] Embedding semântico excedeu o orçamento', {
          event: 'chat.rag_embedding_timeout',
          requestId: input.requestId ?? null,
          timeoutMs: SEMANTIC_EMBEDDING_TIMEOUT_MS,
          durationMs: Date.now() - startedAt,
        });
      }
      return this.fallback(baseResult, startedAt, error instanceof Error ? error.name : 'UNKNOWN_ERROR', input.requestId);
    }
  }

  private fallback(
    result: Pick<ChatRagResult, 'retrievalQuery' | 'context' | 'citations'>,
    startedAt: number,
    reason: string,
    requestId?: string,
  ): ChatRagResult {
    console.log('[knowledge-retrieval-chat.provider.ts] [Chat RAG] Recuperação indisponível; seguindo sem evidências', {
      event: 'chat.rag_failed_non_blocking',
      requestId: requestId ?? null,
      reason,
      durationMs: Date.now() - startedAt,
    });
    return {
      ...result,
      used: false,
      metrics: {
        candidateCount: 0,
        selectedCount: 0,
        durationMs: Date.now() - startedAt,
      },
    };
  }
}

function formatPageRange(start: number | null, end: number | null) {
  if (start === null && end === null) return 'não informada';
  if (start === end || end === null) return `${start}`;
  return `${start}-${end}`;
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}
