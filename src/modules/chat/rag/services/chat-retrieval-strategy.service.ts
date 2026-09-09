export type ChatRetrievalStrategy =
  | 'DIRECT_QUESTION_SOURCE'
  | 'DIRECT_FLASHCARD_SOURCE'
  | 'EVIDENCE_CACHE'
  | 'SEMANTIC_RETRIEVAL';

export type ChatRetrievalStrategyReason =
  | 'QUESTION_HAS_OFFICIAL_EVIDENCE'
  | 'FLASHCARD_HAS_OFFICIAL_EVIDENCE'
  | 'EVIDENCE_CACHE_HIT'
  | 'EVIDENCE_INSUFFICIENT';

export type ChatRetrievalDecision = {
  strategy: ChatRetrievalStrategy;
  shouldEmbed: boolean;
  reason: ChatRetrievalStrategyReason;
};

export type ChatRetrievalStrategyInput = {
  questionEvidence: { sufficient: boolean } | null;
  flashcardEvidence: { sufficient: boolean } | null;
  cacheHit: boolean;
};

export class ChatRetrievalStrategyService {
  choose(input: ChatRetrievalStrategyInput): ChatRetrievalDecision {
    if (input.questionEvidence?.sufficient) {
      return {
        strategy: 'DIRECT_QUESTION_SOURCE',
        shouldEmbed: false,
        reason: 'QUESTION_HAS_OFFICIAL_EVIDENCE',
      };
    }
    if (input.flashcardEvidence?.sufficient) {
      return {
        strategy: 'DIRECT_FLASHCARD_SOURCE',
        shouldEmbed: false,
        reason: 'FLASHCARD_HAS_OFFICIAL_EVIDENCE',
      };
    }
    if (input.cacheHit) {
      return {
        strategy: 'EVIDENCE_CACHE',
        shouldEmbed: false,
        reason: 'EVIDENCE_CACHE_HIT',
      };
    }
    return {
      strategy: 'SEMANTIC_RETRIEVAL',
      shouldEmbed: true,
      reason: 'EVIDENCE_INSUFFICIENT',
    };
  }
}
