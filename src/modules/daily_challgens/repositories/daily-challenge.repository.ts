import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';

export class DailyChallengeRepository {
  findEligibleMonitors() {
    return prisma.monitor.findMany({ where: { status: 'PUBLISHED' }, select: { id: true } });
  }

  findApprovedUnusedQuestions(monitorId: string) {
    return prisma.question.findMany({
      where: {
        monitorId,
        status: 'APPROVED',
        dailyChallenges: { none: {} },
      },
      select: { id: true },
    });
  }

  findByMonitorAndDate(monitorId: string, challengeDate: string) {
    return prisma.dailyChallenge.findUnique({
      where: { monitorId_challengeDate: { monitorId, challengeDate: new Date(`${challengeDate}T00:00:00.000Z`) } },
      include: { question: { include: { subject: true, topic: true } } },
    });
  }

  findCurrentForStudent(monitorId: string, challengeDate: string, studentId: string) {
    return prisma.dailyChallenge.findUnique({
      where: { monitorId_challengeDate: { monitorId, challengeDate: new Date(`${challengeDate}T00:00:00.000Z`) } },
      include: {
        question: { include: { subject: true, topic: true } },
        attempts: { where: { studentId }, select: { id: true, isCorrect: true, answeredAt: true } },
      },
    });
  }

  findStudentByUserId(userId: string) {
    return prisma.student.findUnique({ where: { userId }, select: { id: true, fullName: true, email: true } });
  }

  findActiveEnrollment(studentId: string, monitorId: string) {
    return prisma.studentEnrollment.findFirst({ where: { studentId, monitorId, status: 'ACTIVE' }, select: { id: true } });
  }

  async findActiveEnrollmentMonitorIds(studentId: string) {
    const enrollments = await prisma.studentEnrollment.findMany({ where: { studentId, status: 'ACTIVE' }, select: { monitorId: true } });
    return enrollments.map((enrollment) => enrollment.monitorId);
  }

  findCurrentForStudentMonitors(monitorIds: string[], challengeDate: string, studentId: string) {
    return prisma.dailyChallenge.findMany({
      where: { monitorId: { in: monitorIds }, challengeDate: new Date(`${challengeDate}T00:00:00.000Z`) },
      orderBy: { monitorId: 'asc' },
      include: {
        question: { include: { subject: true, topic: true } },
        attempts: { where: { studentId }, select: { id: true, isCorrect: true, answeredAt: true } },
      },
    });
  }

  getChallengeForAnswer(challengeId: string) {
    return prisma.dailyChallenge.findUnique({ where: { id: challengeId }, include: { question: true } });
  }

  createChallenge(data: Prisma.DailyChallengeCreateInput) {
    return prisma.dailyChallenge.create({ data });
  }

  async answerChallenge(data: {
    studentId: string;
    challengeId: string;
    selectedAnswer: string;
    responseTimeMs?: number;
    answeredAt: Date;
  }) {
    return prisma.$transaction(async (tx) => {
      const challenge = await tx.dailyChallenge.findUniqueOrThrow({
        where: { id: data.challengeId },
        include: { question: true },
      });
      const existing = await tx.dailyChallengeAttempt.findUnique({
        where: { dailyChallengeId_studentId: { dailyChallengeId: data.challengeId, studentId: data.studentId } },
        include: { questionAttempt: true },
      });
      if (existing) return { alreadyAnswered: true as const, challenge, attempt: existing };

      const normalizedSelected = data.selectedAnswer.trim().toUpperCase();
      const normalizedCorrect = challenge.question.correctAnswer?.trim().toUpperCase();
      const isCorrect = Boolean(normalizedCorrect && normalizedSelected === normalizedCorrect);
      const questionAttempt = await tx.studentQuestionAttempt.create({
        data: {
          studentId: data.studentId,
          questionId: challenge.questionId,
          monitorId: challenge.monitorId,
          dailyChallengeId: challenge.id,
          mode: 'DAILY_CHALLENGE',
          selectedAnswer: data.selectedAnswer.trim(),
          isCorrect,
          responseTimeMs: data.responseTimeMs,
          answeredAt: data.answeredAt,
        },
      });
      const attempt = await tx.dailyChallengeAttempt.create({
        data: {
          dailyChallengeId: challenge.id,
          studentId: data.studentId,
          questionAttemptId: questionAttempt.id,
          isCorrect,
          answeredAt: data.answeredAt,
        },
        include: { questionAttempt: true },
      });
      return { alreadyAnswered: false as const, challenge, attempt };
    });
  }

  getRanking(monitorId: string, start: Date, end: Date) {
    return prisma.dailyChallengeAttempt.groupBy({
      by: ['studentId'],
      where: {
        isCorrect: true,
        answeredAt: { gte: start, lt: end },
        dailyChallenge: { monitorId },
      },
      _count: { _all: true },
      orderBy: { _count: { studentId: 'desc' } },
    });
  }
}
