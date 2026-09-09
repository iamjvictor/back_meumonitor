export type FlashcardEvidenceCitation = {
  chunkId: string;
  documentId: string;
  blockId: string | null;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
};

export type FlashcardEvidenceResult = {
  strategy: 'DIRECT_FLASHCARD_SOURCE' | 'EVIDENCE_CACHE' | 'SEMANTIC_RETRIEVAL';
  sufficient: boolean;
  flashcardId: string;
  front: string;
  back: string;
  topicId: string;
  citations: FlashcardEvidenceCitation[];
  context: string;
  metrics: {
    sourceCount: number;
    chunkCount: number;
    durationMs: number;
  };
};
