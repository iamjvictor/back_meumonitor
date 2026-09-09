import type { PrismaClient } from '@prisma/client';
import {
  isQuestionEvidenceSufficient,
  type QuestionEvidenceResult,
  type QuestionEvidenceSourceRole,
} from '../models/question-evidence.model.js';
import type { QuestionEvidenceInput, QuestionEvidencePort } from '../ports/question-evidence.port.js';
import { buildQuestionEvidenceContext } from '../services/question-evidence.context.js';

type QuestionEvidenceClient = Pick<PrismaClient, 'question'>;

const SOURCE_ROLE_ORDER: Record<QuestionEvidenceSourceRole, number> = {
  ANSWER_KEY: 1,
  EXPLANATION: 2,
  CONTEXT: 3,
  STATEMENT: 4,
};

export class PrismaQuestionEvidenceProvider implements QuestionEvidencePort {
  constructor(private readonly client: QuestionEvidenceClient) {}

  async get(input: QuestionEvidenceInput): Promise<QuestionEvidenceResult | null> {
    const startedAt = Date.now();
    const question = await this.client.question.findFirst({
      where: {
        id: input.questionId,
        teacherId: input.teacherId,
        monitorId: input.monitorId,
        subjectId: input.subjectId,
      },
      select: {
        id: true,
        correctAnswer: true,
        correctAnswerConfidence: true,
        explanation: true,
        explanationConfidence: true,
        sources: {
          orderBy: [{ confidence: 'desc' }, { createdAt: 'asc' }],
          select: {
            role: true,
            confidence: true,
            excerpt: true,
            chunkId: true,
            documentId: true,
            documentBlockId: true,
            chunk: {
              select: {
                id: true,
                content: true,
                status: true,
                pageStart: true,
                pageEnd: true,
                blockId: true,
                documentId: true,
              },
            },
            documentBlock: {
              select: {
                id: true,
                type: true,
                normalizedContent: true,
                pageStart: true,
                pageEnd: true,
              },
            },
          },
        },
      },
    });

    if (!question) return null;

    const orderedSources = [...question.sources]
      .filter((source) => source.chunk.status === 'READY')
      .sort((left, right) => (
        sourceRoleOrder(left.role) - sourceRoleOrder(right.role)
        || (right.confidence ?? -1) - (left.confidence ?? -1)
      ));
    const sourcesForSufficiency = question.sources.map((source) => ({
      role: normalizeRole(source.role),
      chunkStatus: source.chunk.status,
    }));
    const citations = orderedSources.map((source) => ({
      chunkId: source.chunk.id,
      documentId: source.chunk.documentId,
      blockId: source.chunk.blockId ?? source.documentBlock?.id ?? source.documentBlockId,
      role: normalizeRole(source.role),
      content: source.chunk.content || source.documentBlock?.normalizedContent || source.excerpt || '',
      confidence: source.confidence,
      pageStart: source.chunk.pageStart ?? source.documentBlock?.pageStart ?? null,
      pageEnd: source.chunk.pageEnd ?? source.documentBlock?.pageEnd ?? null,
    })).filter((citation) => citation.content.trim().length > 0);
    const context = buildQuestionEvidenceContext({
      strategy: 'DIRECT_QUESTION_SOURCE',
      sufficient: isQuestionEvidenceSufficient({
        correctAnswer: question.correctAnswer,
        correctAnswerConfidence: question.correctAnswerConfidence,
        sources: sourcesForSufficiency,
      }),
      questionId: question.id,
      answer: question.correctAnswer,
      explanation: question.explanation,
      citations,
      context: '',
      metrics: {
        sourceCount: orderedSources.length,
        chunkCount: citations.length,
        answerKeyCount: citations.filter((citation) => citation.role === 'ANSWER_KEY').length,
        explanationCount: citations.filter((citation) => citation.role === 'EXPLANATION').length,
        durationMs: 0,
      },
    });
    const sufficient = isQuestionEvidenceSufficient({
      correctAnswer: question.correctAnswer,
      correctAnswerConfidence: question.correctAnswerConfidence,
      sources: sourcesForSufficiency,
    });

    return {
      strategy: 'DIRECT_QUESTION_SOURCE',
      sufficient,
      questionId: question.id,
      answer: question.correctAnswer,
      explanation: question.explanation,
      citations,
      context,
      metrics: {
        sourceCount: orderedSources.length,
        chunkCount: citations.length,
        answerKeyCount: citations.filter((citation) => citation.role === 'ANSWER_KEY').length,
        explanationCount: citations.filter((citation) => citation.role === 'EXPLANATION').length,
        durationMs: Date.now() - startedAt,
      },
    };
  }
}

function sourceRoleOrder(role: string) {
  return SOURCE_ROLE_ORDER[normalizeRole(role)];
}

function normalizeRole(role: string): QuestionEvidenceSourceRole {
  if (role === 'ANSWER_KEY' || role === 'EXPLANATION' || role === 'STATEMENT') return role;
  return 'CONTEXT';
}

function formatPageRange(start: number | null, end: number | null) {
  if (start === null && end === null) return 'não informada';
  if (start === end || end === null) return `${start}`;
  return `${start}-${end}`;
}
