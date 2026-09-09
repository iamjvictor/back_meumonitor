import { z } from 'zod';

export const chatContextAttachmentSchema = z.object({
  type: z.enum(['QUESTION', 'FLASHCARD']),
  id: z.string().trim().min(1).max(100),
  attemptId: z.string().trim().min(1).max(100).nullable().optional(),
  monitorId: z.string().trim().min(1).max(100).optional(),
  subjectId: z.string().trim().min(1).max(100).optional(),
}).strict();

export type ChatContextAttachment = z.infer<typeof chatContextAttachmentSchema>;

const questionContextSchema = z.object({
  questionId: z.string().trim().min(1).optional().nullable(),
  questionAttemptId: z.string().trim().min(1).optional().nullable(),
  number: z.number().int().positive().optional(),
  topic: z.string().trim().min(1).max(240).optional(),
  statement: z.string().trim().min(1).max(20_000).optional(),
  options: z.array(z.object({
    label: z.string().trim().min(1).max(5),
    text: z.string().trim().min(1).max(4_000),
  })).max(10).optional(),
  selectedOption: z.string().trim().min(1).max(5).optional().nullable(),
}).strict();

export const chatMessageInputSchema = z.object({
  message: z.string().trim().min(1).max(8_000),
  topicId: z.string().trim().min(1).max(100).optional().nullable(),
  questionContext: questionContextSchema.optional(),
  contextAttachment: chatContextAttachmentSchema.nullable().optional(),
}).strict();

export type ChatMessageInput = z.infer<typeof chatMessageInputSchema>;
