import { z } from 'zod';

export const weeklySimulationAnswerSchema = z.object({
  selectedAnswer: z.string().trim().min(1).max(500),
  responseTimeMs: z.number().int().min(0).max(86_400_000).optional(),
}).strict();

export type WeeklySimulationAnswerInput = z.infer<typeof weeklySimulationAnswerSchema>;

export const weeklySimulationSubmissionSchema = z.object({
  answers: z.array(z.object({ itemId: z.string().uuid(), selectedAnswer: z.string().trim().min(1).max(500), responseTimeMs: z.number().int().min(0).max(86_400_000).optional() }).strict()).min(1),
}).strict();
