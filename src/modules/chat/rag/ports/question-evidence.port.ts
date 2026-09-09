import type {
  QuestionEvidenceResult,
} from '../models/question-evidence.model.js';
import type { ChatRagResult } from '../models/chat-rag.model.js';

export type QuestionEvidenceInput = {
  questionId: string;
  teacherId: string;
  monitorId: string;
  subjectId: string;
};

export interface QuestionEvidencePort {
  get(input: QuestionEvidenceInput): Promise<QuestionEvidenceResult | null>;
}

export type ChatEvidenceCacheScope = {
  teacherId: string;
  monitorId: string;
  subjectId: string;
};

export type QuestionEvidenceCacheInput = ChatEvidenceCacheScope & {
  questionId: string;
};

export type FlashcardEvidenceCacheInput = ChatEvidenceCacheScope & {
  flashcardId: string;
};

export interface ChatEvidenceCachePort {
  getQuestion(input: QuestionEvidenceCacheInput): Promise<ChatRagResult | null>;
  setQuestion(input: QuestionEvidenceCacheInput, result: ChatRagResult): Promise<void>;
  getFlashcard(input: FlashcardEvidenceCacheInput): Promise<ChatRagResult | null>;
  setFlashcard(input: FlashcardEvidenceCacheInput, result: ChatRagResult): Promise<void>;
}
