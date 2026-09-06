import { Prisma } from '@prisma/client';
import type { FlashcardReviewInput, QuestionReviewInput } from '../models/content-review.model.js';
import { prisma } from '../lib/prisma.js';
import { computeFlashcardFrontHash } from '../services/flashcard-front-hash.js';

export async function reviewQuestion(
  userId: string,
  monitorId: string | null,
  questionId: string,
  input: QuestionReviewInput,
) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(questionId);
  if (!isUuid) return null;

  const question = await prisma.question.findFirst({
    where: {
      id: questionId,
      ...(monitorId ? { monitorId } : {}),
      monitor: { teacher: { userId } },
    },
    select: { id: true, subjectId: true, topicId: true, alternatives: true, correctAnswer: true, explanation: true, status: true },
  });
  if (!question) return null;

  let topicId = input.primaryTopicId !== undefined ? input.primaryTopicId : question.topicId;
  let subjectId = input.subjectId !== undefined && input.subjectId ? input.subjectId : question.subjectId;

  if (input.primaryTopicId) {
    const topic = await prisma.monitorTopic.findFirst({
      where: { id: input.primaryTopicId },
      select: { id: true, subjectId: true },
    });
    if (!topic) throw new Error('QUESTION_TOPIC_NOT_FOUND');
    subjectId = topic.subjectId;
  } else if (input.subjectId) {
    const subject = await prisma.monitorSubject.findFirst({
      where: { id: input.subjectId },
      select: { id: true },
    });
    if (!subject) throw new Error('QUESTION_SUBJECT_NOT_FOUND');
  }

  const correctAnswer = input.correctAnswer !== undefined ? input.correctAnswer : question.correctAnswer;
  const alternatives = input.alternatives ?? parseAlternatives(question.alternatives);
  const explanation = input.explanation !== undefined ? input.explanation : question.explanation;
  const status = input.status ?? question.status;

  if (status === 'APPROVED') {
    if (!topicId) throw new Error('QUESTION_REQUIRES_PRIMARY_TOPIC');
    if (!correctAnswer) throw new Error('QUESTION_REQUIRES_ANSWER_KEY');
    if (!hasFiveMultipleChoiceAlternatives(alternatives)) throw new Error('QUESTION_REQUIRES_FIVE_ALTERNATIVES');
    if (!explanation?.trim()) throw new Error('QUESTION_REQUIRES_EXPLANATION');
  }

  const teacher = await prisma.teacher.findUnique({ where: { userId }, select: { id: true } });
  return prisma.$transaction(async (transaction) => {
    const updated = await transaction.question.update({
      where: { id: question.id },
      data: {
        status,
        subjectId,
        topicId,
        text: input.text !== undefined ? input.text : undefined,
        alternatives: input.alternatives !== undefined ? (input.alternatives as Prisma.InputJsonValue) : undefined,
        correctAnswer: input.correctAnswer !== undefined ? input.correctAnswer : undefined,
        correctAnswerOrigin: input.correctAnswer !== undefined ? 'TEACHER' : undefined,
        explanation: input.explanation !== undefined ? input.explanation : undefined,
        explanationOrigin: input.explanation !== undefined ? 'TEACHER' : undefined,
        reviewedAt: new Date(),
        reviewedBy: teacher?.id,
      },
    });
    if (input.primaryTopicId !== undefined) {
      await transaction.questionTopic.updateMany({ where: { questionId: question.id }, data: { isPrimary: false } });
      if (input.primaryTopicId) {
        await transaction.questionTopic.upsert({
          where: { questionId_topicId: { questionId: question.id, topicId: input.primaryTopicId } },
          update: { isPrimary: true },
          create: { questionId: question.id, topicId: input.primaryTopicId, isPrimary: true },
        });
      }
    }
    return updated;
  });
}

export async function createQuestion(
  userId: string,
  monitorId: string,
  input: QuestionReviewInput & { text: string },
) {
  console.log('[ContentReviewRepository] createQuestion called with:', {
    userId,
    monitorId,
    subjectId: input.subjectId,
    primaryTopicId: input.primaryTopicId,
    textLength: input.text?.length,
    alternativesCount: input.alternatives?.length,
    correctAnswer: input.correctAnswer,
    explanationLength: input.explanation?.length,
  });

  const teacher = await prisma.teacher.findUnique({ where: { userId }, select: { id: true } });
  if (!teacher) {
    console.error('[ContentReviewRepository] Teacher not found for userId:', userId);
    throw new Error('TEACHER_NOT_FOUND');
  }

  const monitor = await prisma.monitor.findFirst({
    where: { id: monitorId, teacherId: teacher.id },
    include: { subjects: true },
  });
  if (!monitor) {
    console.error('[ContentReviewRepository] Monitor not found for monitorId:', monitorId);
    throw new Error('MONITOR_NOT_FOUND');
  }

  let topicId = input.primaryTopicId || null;
  let subjectId = input.subjectId || null;

  if (topicId) {
    const topic = await prisma.monitorTopic.findFirst({
      where: { id: topicId },
      select: { id: true, subjectId: true },
    });
    if (topic) {
      subjectId = topic.subjectId;
    }
  }

  if (!subjectId && monitor.subjects[0]) {
    subjectId = monitor.subjects[0].id;
  }

  if (!subjectId) {
    console.error('[ContentReviewRepository] Question requires a valid subjectId');
    throw new Error('QUESTION_REQUIRES_SUBJECT');
  }

  const crypto = await import('crypto');
  const textHash = crypto.createHash('sha256').update(`${topicId || ''}:${input.text}`).digest('hex');
  const sourceKey = `manual:${teacher.id}:${Date.now()}:${Math.random().toString(36).substring(2, 7)}`;

  const alternatives = input.alternatives || [];
  const status = input.status || 'APPROVED';

  console.log('[ContentReviewRepository] Creating Question record in Prisma...', {
    teacherId: teacher.id,
    monitorId,
    subjectId,
    topicId,
    textHash,
    sourceKey,
    status,
  });

  const newQuestion = await prisma.question.create({
    data: {
      teacherId: teacher.id,
      monitorId,
      subjectId,
      topicId,
      text: input.text,
      alternatives: alternatives as Prisma.InputJsonValue,
      correctAnswer: input.correctAnswer || null,
      correctAnswerOrigin: 'TEACHER',
      explanation: input.explanation || null,
      explanationOrigin: 'TEACHER',
      statementOrigin: 'TEACHER_CREATED',
      kind: 'MULTIPLE_CHOICE',
      textHash,
      sourceKey,
      status,
      reviewedAt: new Date(),
      reviewedBy: teacher.id,
      ...(topicId
        ? {
            topicLinks: {
              create: {
                topicId,
                isPrimary: true,
              },
            },
          }
        : {}),
    },
    include: {
      topic: { select: { id: true, name: true } },
      subject: { select: { id: true, name: true } },
    },
  });

  console.log('[ContentReviewRepository] Question created successfully! ID:', newQuestion.id);
  return newQuestion;
}


function parseAlternatives(value: Prisma.JsonValue) {
  return Array.isArray(value) ? value : [];
}

function hasFiveMultipleChoiceAlternatives(value: unknown[]) {
  if (value.length !== 5) return false;
  return value.every((alternative, index) => (
    typeof alternative === 'object'
    && alternative !== null
    && (alternative as { label?: unknown }).label === String.fromCharCode('A'.charCodeAt(0) + index)
    && typeof (alternative as { text?: unknown }).text === 'string'
    && (alternative as { text: string }).text.trim().length > 0
  ));
}

export async function listQuestionsForMonitor(userId: string, monitorId: string) {
  const teacher = await prisma.teacher.findUnique({ where: { userId }, select: { id: true } });
  if (!teacher) return [];

  return prisma.question.findMany({
    where: { monitorId, teacherId: teacher.id },
    include: {
      topic: { select: { id: true, name: true } },
      subject: { select: { id: true, name: true } },
      sources: {
        select: {
          document: { select: { originalName: true } },
        },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listFlashcardsForMonitor(userId: string, monitorId: string) {
  const teacher = await prisma.teacher.findUnique({ where: { userId }, select: { id: true } });
  if (!teacher) return [];

  return prisma.flashcard.findMany({
    where: { monitorId, teacherId: teacher.id },
    include: {
      topic: { select: { id: true, name: true } },
      subject: { select: { id: true, name: true } },
      sources: {
        select: {
          chunk: {
            select: {
              document: { select: { originalName: true } },
            },
          },
        },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listDocumentsForMonitor(userId: string, monitorId: string) {
  const teacher = await prisma.teacher.findUnique({ where: { userId }, select: { id: true } });
  if (!teacher) return [];

  return prisma.monitorDocument.findMany({
    where: { monitorId, teacherId: teacher.id },
    include: {
      subject: { select: { id: true, name: true } },
      topic: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function reviewFlashcard(
  userId: string,
  monitorId: string | null,
  flashcardId: string,
  input: FlashcardReviewInput,
) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(flashcardId);
  if (!isUuid) return null;

  const teacher = await prisma.teacher.findUnique({ where: { userId }, select: { id: true } });
  if (!teacher) return null;
  const flashcard = await prisma.flashcard.findFirst({
    where: { id: flashcardId, ...(monitorId ? { monitorId } : {}), teacherId: teacher.id },
    select: { id: true, status: true },
  });
  if (!flashcard) return null;

  const front = input.front;
  return prisma.flashcard.update({
    where: { id: flashcard.id },
    data: {
      status: input.status ?? flashcard.status,
      front: input.front !== undefined ? input.front : undefined,
      back: input.back !== undefined ? input.back : undefined,
      frontHash: front ? computeFlashcardFrontHash(front) : undefined,
      reviewedAt: new Date(),
      reviewedBy: teacher.id,
    },
  });
}
