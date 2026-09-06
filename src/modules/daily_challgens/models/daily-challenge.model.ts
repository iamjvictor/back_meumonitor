import { z } from 'zod';

export const answerChallengeSchema = z.object({
  selectedAnswer: z.string().trim().min(1).max(500),
  responseTimeMs: z.number().int().min(0).max(86_400_000).optional(),
});

export const rankingMonthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'month deve estar no formato YYYY-MM');

export type AnswerChallengeInput = z.infer<typeof answerChallengeSchema>;

export const DAILY_CHALLENGE_SELECTION_STRATEGY = 'RANDOM_UNUSED_APPROVED';
