import type { ChatKnowledgePort } from '../ports/chat-knowledge.port.js';
import type { ChatRagInput, ChatRagResult } from '../models/chat-rag.model.js';
import { ChatContextAssembler } from './chat-context.assembler.js';
import { ChatRetrievalStrategyService } from './chat-retrieval-strategy.service.js';
import type { FlashcardEvidenceResult } from '../models/flashcard-evidence.model.js';
import type { QuestionEvidenceResult } from '../models/question-evidence.model.js';
import { buildQuestionEvidenceContext } from './question-evidence.context.js';
import { buildFlashcardEvidenceContext } from './flashcard-evidence.context.js';
import type { ChatEvidenceCachePort } from '../ports/question-evidence.port.js';

export type ChatRagEnrichment = {
  result: ChatRagResult;
  context: string;
};

/** Orquestra recuperação e montagem do contexto sem conhecer Redis ou HTTP. */
export class ChatRagService {
  constructor(
    private readonly knowledge: ChatKnowledgePort,
    private readonly contextAssembler = new ChatContextAssembler(),
    private readonly strategy = new ChatRetrievalStrategyService(),
    private readonly evidenceCache?: ChatEvidenceCachePort,
  ) {}

  async enrich(input: ChatRagInput): Promise<ChatRagEnrichment> {
    let cachedRag = input.cachedRag ?? null;
    if (!cachedRag && this.evidenceCache && (input.questionEvidence || input.questionId)) {
      cachedRag = await this.readQuestionCache(input);
    }
    if (!cachedRag && this.evidenceCache && (input.flashcardEvidence || input.flashcardId)) {
      cachedRag = await this.readFlashcardCache(input);
    }
    const decision = this.strategy.choose({
      questionEvidence: input.questionEvidence ?? null,
      flashcardEvidence: input.flashcardEvidence ?? null,
      cacheHit: Boolean(cachedRag),
    });
    console.log('[chat-rag.service.ts] [Chat RAG] Estratégia selecionada', {
      event: 'chat.rag_strategy_selected',
      requestId: input.requestId ?? null,
      strategy: decision.strategy,
      shouldEmbed: decision.shouldEmbed,
      reason: decision.reason,
    });

    let result: ChatRagResult;
    if (cachedRag) {
      result = cachedRag;
    } else if (input.questionEvidence?.sufficient) {
      result = questionEvidenceToRagResult(input.questionEvidence, input.message);
    } else if (input.flashcardEvidence?.sufficient) {
      result = flashcardEvidenceToRagResult(input.flashcardEvidence, input.message);
    } else {
      try {
        result = await this.knowledge.retrieve(input);
      } catch (error) {
        console.log('[chat-rag.service.ts] [Chat RAG] Falha inesperada no serviço; seguindo sem evidências', {
          event: 'chat.rag_failed_non_blocking',
          requestId: input.requestId ?? null,
          reason: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        });
        result = {
          used: false,
          retrievalQuery: '',
          context: '',
          citations: [],
          metrics: { candidateCount: 0, selectedCount: 0, durationMs: 0 },
        };
      }
    }
    if (!cachedRag && this.evidenceCache && result.used && (
      input.questionEvidence?.sufficient || input.flashcardEvidence?.sufficient
    )) {
      const normalizedResult = { ...result, retrievalQuery: '' };
      try {
        if (input.questionEvidence?.sufficient && input.questionEvidence.questionId) {
          await this.evidenceCache.setQuestion({
            teacherId: input.teacherId,
            monitorId: input.monitorId,
            subjectId: input.subjectId,
            questionId: input.questionEvidence.questionId,
          }, normalizedResult);
          console.log('[chat-rag.service.ts] [Chat RAG] Evidência de questão salva no cache', {
            event: 'chat.rag_evidence_cache_written',
            requestId: input.requestId ?? null,
            kind: 'QUESTION',
            evidenceId: input.questionEvidence.questionId,
          });
        } else if (input.flashcardEvidence?.sufficient && input.flashcardEvidence.flashcardId) {
          await this.evidenceCache.setFlashcard({
            teacherId: input.teacherId,
            monitorId: input.monitorId,
            subjectId: input.subjectId,
            flashcardId: input.flashcardEvidence.flashcardId,
          }, normalizedResult);
          console.log('[chat-rag.service.ts] [Chat RAG] Evidência de flashcard salva no cache', {
            event: 'chat.rag_evidence_cache_written',
            requestId: input.requestId ?? null,
            kind: 'FLASHCARD',
            evidenceId: input.flashcardEvidence.flashcardId,
          });
        }
      } catch (error) {
        console.log('[chat-rag.service.ts] [Chat RAG] Falha ao salvar evidência no cache', {
          event: 'chat.rag_evidence_cache_write_failed',
          requestId: input.requestId ?? null,
          reason: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        });
      }
    }
    const context = this.contextAssembler.assemble({
      message: input.message,
      history: input.history,
      questionContext: input.questionContext,
      rag: result,
    });

    console.log('[chat-rag.service.ts] [Chat RAG] Contexto montado', {
      event: 'chat.rag_context_assembled',
      requestId: input.requestId ?? null,
      used: result.used,
      citationCount: result.citations.length,
      contextChars: context.length,
      historyCount: input.history.length,
    });

    return {
      result,
      context,
    };
  }

  private async readQuestionCache(input: ChatRagInput) {
    if (!this.evidenceCache) return null;
    const evidenceId = input.questionEvidence?.questionId ?? input.questionId;
    if (!evidenceId) return null;
    try {
      const result = await this.evidenceCache.getQuestion({
        teacherId: input.teacherId,
        monitorId: input.monitorId,
        subjectId: input.subjectId,
        questionId: evidenceId,
      });
      console.log('[chat-rag.service.ts] [Chat RAG] Cache de evidência de questão consultado', {
        event: result ? 'chat.rag_evidence_cache_hit' : 'chat.rag_evidence_cache_miss',
        requestId: input.requestId ?? null,
        kind: 'QUESTION',
        evidenceId,
      });
      return result;
    } catch (error) {
      console.log('[chat-rag.service.ts] [Chat RAG] Falha ao consultar cache de questão', {
        event: 'chat.rag_evidence_cache_miss',
        requestId: input.requestId ?? null,
        kind: 'QUESTION',
        evidenceId,
        reason: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      });
      return null;
    }
  }

  private async readFlashcardCache(input: ChatRagInput) {
    if (!this.evidenceCache) return null;
    const evidenceId = input.flashcardEvidence?.flashcardId ?? input.flashcardId;
    if (!evidenceId) return null;
    try {
      const result = await this.evidenceCache.getFlashcard({
        teacherId: input.teacherId,
        monitorId: input.monitorId,
        subjectId: input.subjectId,
        flashcardId: evidenceId,
      });
      console.log('[chat-rag.service.ts] [Chat RAG] Cache de evidência de flashcard consultado', {
        event: result ? 'chat.rag_evidence_cache_hit' : 'chat.rag_evidence_cache_miss',
        requestId: input.requestId ?? null,
        kind: 'FLASHCARD',
        evidenceId,
      });
      return result;
    } catch (error) {
      console.log('[chat-rag.service.ts] [Chat RAG] Falha ao consultar cache de flashcard', {
        event: 'chat.rag_evidence_cache_miss',
        requestId: input.requestId ?? null,
        kind: 'FLASHCARD',
        evidenceId,
        reason: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      });
      return null;
    }
  }
}

function questionEvidenceToRagResult(evidence: QuestionEvidenceResult, message: string): ChatRagResult {
  return {
    used: evidence.sufficient,
    retrievalQuery: message,
    context: buildQuestionEvidenceContext(evidence),
    citations: evidence.citations.map((citation) => ({
      chunkId: citation.chunkId,
      documentId: citation.documentId,
      blockId: citation.blockId,
      pageStart: citation.pageStart,
      pageEnd: citation.pageEnd,
      score: citation.confidence ?? 1,
      content: citation.content,
    })),
    metrics: {
      candidateCount: evidence.metrics.sourceCount,
      selectedCount: evidence.metrics.chunkCount,
      durationMs: evidence.metrics.durationMs,
      scoreAverage: averageConfidence(evidence.citations.map((citation) => citation.confidence)),
      scoreMin: null,
      scoreMax: null,
    },
  };
}

function flashcardEvidenceToRagResult(evidence: FlashcardEvidenceResult, message: string): ChatRagResult {
  return {
    used: evidence.sufficient,
    retrievalQuery: message,
    context: buildFlashcardEvidenceContext(evidence),
    citations: evidence.citations.map((citation) => ({
      chunkId: citation.chunkId,
      documentId: citation.documentId,
      blockId: citation.blockId,
      pageStart: citation.pageStart,
      pageEnd: citation.pageEnd,
      score: 1,
      content: citation.content,
    })),
    metrics: {
      candidateCount: evidence.metrics.sourceCount,
      selectedCount: evidence.metrics.chunkCount,
      durationMs: evidence.metrics.durationMs,
      scoreAverage: evidence.citations.length > 0 ? 1 : null,
      scoreMin: evidence.citations.length > 0 ? 1 : null,
      scoreMax: evidence.citations.length > 0 ? 1 : null,
    },
  };
}

function averageConfidence(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null);
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}
