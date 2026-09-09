import type { AuthorizedQuestionContext } from '../../models/chat-generation.model.js';
import type { ChatHistoryMessage } from '../../models/chat-history.model.js';
import type { FlashcardEvidenceResult } from './flashcard-evidence.model.js';
import type { QuestionEvidenceResult } from './question-evidence.model.js';

export type ChatRagInput = {
  requestId?: string;
  message: string;
  history: ChatHistoryMessage[];
  questionContext: AuthorizedQuestionContext | null;
  studentId: string;
  teacherId: string;
  monitorId: string;
  subjectId: string;
  topicId: string | null;
  questionDocumentId?: string | null;
  questionBlockId?: string | null;
  questionId?: string | null;
  flashcardId?: string | null;
  questionEvidence?: QuestionEvidenceResult | null;
  flashcardEvidence?: FlashcardEvidenceResult | null;
  cachedRag?: ChatRagResult | null;
};

export type ChatRagCitation = {
  chunkId: string;
  documentId: string;
  blockId: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  score: number;
  content: string;
};

export type ChatRagResult = {
  used: boolean;
  retrievalQuery: string;
  context: string;
  citations: ChatRagCitation[];
  metrics: {
    candidateCount: number;
    selectedCount: number;
    durationMs: number;
    scoreAverage?: number | null;
    scoreMin?: number | null;
    scoreMax?: number | null;
  };
};
