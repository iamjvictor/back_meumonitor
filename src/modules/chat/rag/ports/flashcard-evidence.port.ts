import type { FlashcardEvidenceResult } from '../models/flashcard-evidence.model.js';

export type FlashcardEvidenceInput = {
  flashcardId: string;
  teacherId: string;
  monitorId: string;
  subjectId: string;
};

export interface FlashcardEvidencePort {
  get(input: FlashcardEvidenceInput): Promise<FlashcardEvidenceResult | null>;
}
