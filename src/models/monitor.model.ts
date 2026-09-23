import { z } from 'zod';

const monitorTopicSchema = z.object({
  name: z.string().trim().min(2).max(120),
  definition: z.string().trim().max(4000).optional(),
});

const monitorSubjectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  topics: z.array(monitorTopicSchema).min(1).max(500),
});

const questionBankSelectionSchema = z.object({
  subject: z.string().trim().min(2).max(120),
  topic: z.string().trim().min(2).max(120),
  examType: z.string().trim().min(1).max(60),
  board: z.string().trim().max(120).optional().nullable(),
  subtopic: z.string().trim().max(120).optional().nullable(),
  subsubtopic: z.string().trim().max(120).optional().nullable(),
}).superRefine((selection, context) => {
  if (selection.subsubtopic && !selection.subtopic) {
    context.addIssue({
      code: 'custom',
      path: ['subtopic'],
      message: 'subtopic is required when subsubtopic is provided',
    });
  }
});

export const createMonitorSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(500).optional(),
  subjects: z.array(monitorSubjectSchema).min(1).max(20),
  questionBankSelections: z.array(questionBankSelectionSchema).max(5000).optional(),
});

export const monitorIdParamsSchema = z.object({
  monitorId: z.string().uuid(),
});

export const updateMonitorSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  avatarUrl: z.string().trim().optional().nullable(),
  detailedDescription: z.string().trim().max(2000).optional().nullable(),
  status: z.enum(['DRAFT', 'READY_TO_PUBLISH', 'PUBLISHED', 'PAUSED', 'ARCHIVED']).optional(),
});

export type CreateMonitorInput = z.infer<typeof createMonitorSchema>;
export type UpdateMonitorInput = z.infer<typeof updateMonitorSchema>;
