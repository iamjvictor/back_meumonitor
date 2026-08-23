import { z } from 'zod';

export const documentTagSchema = z.enum(['knowledge', 'questions', 'flashcards']);

export const uploadDocumentSchema = z.object({
  subjectId: z.string().uuid(),
  topicId: z.string().uuid().optional(),
  tag: documentTagSchema,
});

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;

export const documentTagToDatabase = {
  knowledge: 'KNOWLEDGE_BASE',
  questions: 'QUESTIONS',
  flashcards: 'FLASHCARDS',
} as const;
