import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import type { WeeklySimulationTopicPool } from '../services/weekly-simulation-distribution.service.js';

export class WeeklySimulationRepository {
  async findSubmissionContext(simulationId: string, userId: string) {
    return prisma.weeklySimulation.findFirst({ where: { id: simulationId, student: { userId } }, select: { studentId: true, monitorId: true, status: true, deadlineAt: true } });
  }

  async submitAnswers(input: { studentId: string; simulationId: string; answers: Array<{ itemId: string; selectedAnswer: string; responseTimeMs?: number }> }) {
    return prisma.$transaction(async (tx) => {
      const simulation = await tx.weeklySimulation.findFirst({ where: { id: input.simulationId, studentId: input.studentId }, include: { items: { include: { question: { select: { correctAnswer: true } } } } } });
      if (!simulation) throw new Error('SIMULATION_NOT_FOUND');
      if (simulation.status !== 'IN_PROGRESS') throw new Error('SIMULATION_NOT_ANSWERABLE');
      if (simulation.deadlineAt && simulation.deadlineAt.getTime() <= Date.now()) throw new Error('SIMULATION_TIME_EXPIRED');
      if (input.answers.length !== simulation.questionCount || new Set(input.answers.map((answer) => answer.itemId)).size !== simulation.questionCount) throw new Error('SIMULATION_ALL_ANSWERS_REQUIRED');
      const items = new Map(simulation.items.map((item) => [item.id, item]));
      let correctCount = 0;
      for (const answer of input.answers) {
        const item = items.get(answer.itemId);
        if (!item) throw new Error('SIMULATION_INVALID_ANSWERS');
        const isCorrect = Boolean(item.question.correctAnswer && item.question.correctAnswer.trim().toUpperCase() === answer.selectedAnswer.trim().toUpperCase());
        if (isCorrect) correctCount += 1;
        await tx.weeklySimulationItem.update({ where: { id: item.id }, data: { selectedAnswer: answer.selectedAnswer.trim(), isCorrect, responseTimeMs: answer.responseTimeMs, answeredAt: new Date() } });
      }
      const completedAt = new Date();
      const durationSeconds = simulation.solvingStartedAt ? Math.floor(Math.max(0, completedAt.getTime() - simulation.solvingStartedAt.getTime()) / 1000) : null;
      await tx.weeklySimulation.update({ where: { id: simulation.id }, data: { status: 'COMPLETED', answeredCount: simulation.questionCount, correctCount, scorePercent: (correctCount / simulation.questionCount) * 100, completedAt, durationSeconds } });
      return { completed: true, durationSeconds };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000, maxWait: 10_000 });
  }

  async findStudentForUser(simulationId: string, userId: string) {
    const simulation = await prisma.weeklySimulation.findFirst({ where: { id: simulationId, student: { userId } }, select: { studentId: true } });
    if (!simulation) throw new Error('SIMULATION_NOT_FOUND');
    return simulation;
  }

  async startForStudent(input: { simulationId: string; studentId: string }) {
    return prisma.$transaction(async (tx) => {
      const simulation = await tx.weeklySimulation.findFirst({ where: { id: input.simulationId, studentId: input.studentId } });
      if (!simulation) throw new Error('SIMULATION_NOT_FOUND');
      if (simulation.status === 'IN_PROGRESS') return simulation;
      if (simulation.status !== 'READY') throw new Error('SIMULATION_NOT_STARTABLE');
      const solvingStartedAt = new Date();
      const deadlineAt = new Date(solvingStartedAt.getTime() + simulation.timeLimitSeconds * 1000);
      return tx.weeklySimulation.update({ where: { id: simulation.id }, data: { status: 'IN_PROGRESS', solvingStartedAt, deadlineAt } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  findByCycle(input: { studentId: string; monitorId: string; cycleStartDate: string }) {
    return prisma.weeklySimulation.findUnique({ where: { studentId_monitorId_cycleStartDate: { studentId: input.studentId, monitorId: input.monitorId, cycleStartDate: new Date(`${input.cycleStartDate}T00:00:00.000Z`) } }, select: { id: true, status: true, requestedAt: true, questionCount: true, answeredCount: true, correctCount: true, scorePercent: true, durationSeconds: true, completedAt: true } });
  }

  findLatestIncompleteBeforeCycle(input: { studentId: string; monitorId: string; cycleStartDate: string }) {
    return prisma.weeklySimulation.findFirst({
      where: { studentId: input.studentId, monitorId: input.monitorId, cycleStartDate: { lt: new Date(`${input.cycleStartDate}T00:00:00.000Z`) }, status: { in: ['PENDING', 'PROCESSING', 'READY', 'IN_PROGRESS'] } },
      orderBy: { cycleStartDate: 'desc' },
      select: { id: true, status: true },
    });
  }

  createPending(input: { studentId: string; monitorId: string; cycleStartDate: string; generationJobId: string }) {
    return prisma.weeklySimulation.upsert({
      where: { studentId_monitorId_cycleStartDate: { studentId: input.studentId, monitorId: input.monitorId, cycleStartDate: new Date(`${input.cycleStartDate}T00:00:00.000Z`) } },
      update: {},
      create: { studentId: input.studentId, monitorId: input.monitorId, cycleStartDate: new Date(`${input.cycleStartDate}T00:00:00.000Z`), generationJobId: input.generationJobId },
      select: { id: true, status: true },
    });
  }

  resetFailedToPending(input: { simulationId: string; generationJobId: string }) {
    return prisma.weeklySimulation.update({ where: { id: input.simulationId }, data: { status: 'PENDING', generationJobId: input.generationJobId, requestedAt: new Date(), startedAt: null, failedAt: null, failureCode: null, failureMessage: null }, select: { id: true, status: true } });
  }

  async getGenerationContext(simulationId: string) {
    return prisma.weeklySimulation.findUniqueOrThrow({ where: { id: simulationId }, select: { id: true, studentId: true, monitorId: true, cycleStartDate: true } });
  }

  async markProcessing(simulationId: string) {
    return prisma.weeklySimulation.update({ where: { id: simulationId }, data: { status: 'PROCESSING', startedAt: new Date(), failureCode: null, failureMessage: null } });
  }

  async findApprovedQuestionPools(studentId: string, monitorId: string): Promise<{ pools: WeeklySimulationTopicPool[]; history: Map<string, boolean> }> {
    const [questions, attempts] = await Promise.all([
      prisma.question.findMany({ where: { monitorId, status: 'APPROVED' }, select: { id: true, monitorId: true, subjectId: true, topicId: true, subject: { select: { id: true } }, topic: { select: { id: true } }, } }),
      prisma.studentQuestionAttempt.findMany({ where: { studentId, monitorId, mode: { in: ['PRACTICE', 'SIMULATED', 'DAILY_CHALLENGE'] }, status: 'ACTIVE' }, orderBy: { answeredAt: 'desc' }, select: { questionId: true, isCorrect: true } }),
    ]);
    const history = new Map<string, boolean>();
    attempts.forEach((attempt) => { if (!history.has(attempt.questionId)) history.set(attempt.questionId, attempt.isCorrect); });
    const pools = new Map<string, WeeklySimulationTopicPool>();
    questions.forEach((question) => {
      const key = `${question.subjectId}:${question.topicId ?? 'none'}`;
      const pool = pools.get(key) ?? { monitorId: question.monitorId, subjectId: question.subjectId, topicId: question.topicId, difficultyScore: 0.5, questions: [] };
      pool.questions.push({ id: question.id, subjectId: question.subjectId, topicId: question.topicId });
      pools.set(key, pool);
    });
    return { pools: Array.from(pools.values()), history };
  }

  async saveGenerated(input: { simulationId: string; items: Array<{ questionId: string; position: number; subjectId: string; topicId: string | null; difficultyScore: number; selectionPriority: 'NEVER_ANSWERED' | 'PREVIOUSLY_INCORRECT' | 'PREVIOUSLY_CORRECT'; selectionReason: string }>; snapshot: Prisma.InputJsonValue }) {
    return prisma.$transaction(async (tx) => {
      await tx.weeklySimulationItem.deleteMany({ where: { simulationId: input.simulationId } });
      await tx.weeklySimulationItem.createMany({ data: input.items.map((item) => ({ ...item, simulationId: input.simulationId })) });
      return tx.weeklySimulation.update({ where: { id: input.simulationId }, data: { status: 'READY', questionCount: input.items.length, diagnosticSnapshot: input.snapshot } });
    });
  }

  markFailed(simulationId: string, error: unknown) {
    return prisma.weeklySimulation.update({ where: { id: simulationId }, data: { status: 'FAILED', failedAt: new Date(), failureCode: error instanceof Error ? error.message : 'GENERATION_FAILED', failureMessage: error instanceof Error ? error.message : String(error) } });
  }

  findForStudent(simulationId: string, studentId: string) {
    return prisma.weeklySimulation.findFirst({
      where: { id: simulationId, studentId },
      include: {
        items: {
          where: { question: { status: 'APPROVED' } },
          orderBy: { position: 'asc' },
          include: {
            question: { select: { id: true, text: true, alternatives: true, kind: true, difficulty: true, explanation: true, correctAnswer: true, subject: { select: { id: true, name: true } }, topic: { select: { id: true, name: true } } } },
          },
        },
      },
    });
  }

  findForUser(simulationId: string, userId: string) {
    return prisma.weeklySimulation.findFirst({
      where: { id: simulationId, student: { userId } },
      include: {
        items: {
          where: { question: { status: 'APPROVED' } },
          orderBy: { position: 'asc' },
          include: {
            question: { select: { id: true, text: true, alternatives: true, kind: true, difficulty: true, explanation: true, correctAnswer: true, subject: { select: { id: true, name: true } }, topic: { select: { id: true, name: true } } } },
          },
        },
      },
    });
  }

  findItemForAnswer(input: { simulationId: string; itemId: string; studentId: string }) {
    return prisma.weeklySimulationItem.findFirst({ where: { id: input.itemId, simulationId: input.simulationId, simulation: { student: { id: input.studentId } } }, include: { question: { select: { correctAnswer: true } }, simulation: { select: { monitorId: true, status: true, deadlineAt: true } } } }).then((item) => item ? { id: item.id, simulationId: item.simulationId, monitorId: item.simulation.monitorId, correctAnswer: item.question.correctAnswer, simulationStatus: item.simulation.status, deadlineAt: item.simulation.deadlineAt, answered: Boolean(item.answeredAt), existing: item.answeredAt ? { isCorrect: Boolean(item.isCorrect) } : undefined } : null);
  }

  findSimulationMonitor(simulationId: string) {
    return prisma.weeklySimulation.findUnique({ where: { id: simulationId }, select: { monitorId: true } });
  }

  async saveAnswer(input: { studentId: string; simulationId: string; itemId: string; selectedAnswer: string; isCorrect: boolean; responseTimeMs?: number }) {
    return prisma.$transaction(async (tx) => {
      const item = await tx.weeklySimulationItem.findUniqueOrThrow({ where: { id: input.itemId }, include: { simulation: true, question: true } });
      if (item.simulationId !== input.simulationId) throw new Error('SIMULATION_ITEM_NOT_FOUND');
      if (item.answeredAt) return { isCorrect: Boolean(item.isCorrect), durationSeconds: null };
      await tx.weeklySimulationItem.update({ where: { id: item.id }, data: { selectedAnswer: input.selectedAnswer, isCorrect: input.isCorrect, responseTimeMs: input.responseTimeMs, answeredAt: new Date() } });
      const answeredCount = item.simulation.answeredCount + 1;
      const correctCount = item.simulation.correctCount + (input.isCorrect ? 1 : 0);
      const completed = answeredCount >= item.simulation.questionCount && item.simulation.questionCount > 0;
      const completedAt = completed ? new Date() : null;
      const completionData = completedAt
        ? {
            status: 'COMPLETED' as const,
            completedAt,
            durationSeconds: item.simulation.solvingStartedAt
              ? Math.floor(Math.max(0, completedAt.getTime() - item.simulation.solvingStartedAt.getTime()) / 1000)
              : null,
            scorePercent: (correctCount / item.simulation.questionCount) * 100,
          }
        : { status: 'IN_PROGRESS' as const };
      await tx.weeklySimulation.update({ where: { id: input.simulationId }, data: { answeredCount, correctCount, ...completionData } });
      return { isCorrect: input.isCorrect, durationSeconds: completedAt ? (item.simulation.solvingStartedAt ? Math.floor(Math.max(0, completedAt.getTime() - item.simulation.solvingStartedAt.getTime()) / 1000) : null) : null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
