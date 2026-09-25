import { z } from 'zod';

export const questionBankProviderSchema = z.enum(['ENEMHUB', 'QAPI']);
export const questionBankExamTypeSchema = z.enum(['ENEM', 'CONCURSO']);

const alternativeSchema = z.object({
  providerId: z.string().trim().min(1).nullable(),
  label: z.string().trim().min(1).max(10),
  text: z.string().trim().min(1).max(20_000),
  isCorrect: z.boolean(),
});

export const normalizedQuestionBankItemSchema = z.object({
  provider: questionBankProviderSchema,
  providerQuestionId: z.string().trim().min(1),
  externalId: z.string().trim().min(1).nullable(),
  examType: questionBankExamTypeSchema,
  examName: z.string().trim().min(1),
  board: z.string().trim().min(1).nullable(),
  institution: z.string().trim().min(1).nullable(),
  examYear: z.number().int().positive().nullable(),
  subject: z.string().trim().min(1),
  topic: z.string().trim().min(1),
  subtopic: z.string().trim().min(1).nullable(),
  subsubtopic: z.string().trim().min(1).nullable(),
  taxonomyPath: z.array(z.string().trim().min(1)).min(1),
  statementHtml: z.string().trim().min(1),
  statementText: z.string().trim().min(1),
  alternatives: z.array(alternativeSchema).min(2).max(10),
  correctAnswer: z.string().trim().min(1).max(10),
  difficulty: z.string().trim().min(1).nullable(),
  sourceUrl: z.string().url().nullable(),
  imageUrls: z.array(z.string().url()),
  rawPayload: z.unknown(),
  sourceFetchedAt: z.date(),
}).superRefine((item, context) => {
  const correctAlternatives = item.alternatives.filter((alternative) => alternative.isCorrect);
  if (correctAlternatives.length !== 1) {
    context.addIssue({
      code: 'custom',
      path: ['alternatives'],
      message: 'A questão deve possuir exatamente uma alternativa correta.',
    });
    return;
  }

  if (correctAlternatives[0]?.label !== item.correctAnswer) {
    context.addIssue({
      code: 'custom',
      path: ['correctAnswer'],
      message: 'correctAnswer deve corresponder à alternativa marcada como correta.',
    });
  }
});

export type NormalizedQuestionBankItem = z.infer<typeof normalizedQuestionBankItemSchema>;
export type QuestionBankProvider = z.infer<typeof questionBankProviderSchema>;
export type QuestionBankExamType = z.infer<typeof questionBankExamTypeSchema>;

export type ProviderPageInput = {
  page: number;
  pageSize: number;
  year?: number;
  subjectId?: string;
};

export type NormalizedProviderPage = {
  items: NormalizedQuestionBankItem[];
  page: number;
  pageSize: number;
  total: number | null;
  hasNextPage: boolean;
};
