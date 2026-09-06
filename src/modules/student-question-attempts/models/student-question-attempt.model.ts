import { z } from 'zod';

export const studentQuestionAttemptSchema = z.object({
  questionId: z.string().uuid(),
  selectedAnswer: z.string().trim().min(1).max(500),
  mode: z.literal('PRACTICE').default('PRACTICE'),
  responseTimeMs: z.number().int().min(0).max(86_400_000).optional(),
  idempotencyKey: z.string().uuid().optional(),
});

export type StudentQuestionAttemptInput = z.infer<typeof studentQuestionAttemptSchema>;

export function calculateQuestionCorrectness(selectedAnswer: string, correctAnswer: string | null | undefined) {
  const selected = selectedAnswer.trim().toUpperCase();
  const correct = correctAnswer?.trim().toUpperCase();
  return Boolean(correct && selected === correct);
}
