import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { StudentRepository } from '../repositories/student.repository.js';
import { TeacherRepository } from '../repositories/teacher.repository.js';
import { prisma } from '../lib/prisma.js';
import { pickRandomAvailable } from '../services/flashcard-selection.js';
import { calculateNextSrsState } from '../services/srs.service.js';

const studentRepo = new StudentRepository();

const teacherRepo = new TeacherRepository();

export async function protectedRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware);

  app.get('/session', async (request) => {
    if (!request.user) throw new Error('Authenticated user was not attached to request');

    let fullName = request.user.fullName;
    let whatsapp = request.user.whatsapp;
    let cpf: string | undefined;
    let avatarUrl: string | undefined;
    let role = request.user.role;

    const teacher = await teacherRepo.findByUserId(request.user.id);
    if (teacher) {
      role = 'teacher';
      if (!fullName) fullName = teacher.fullName;
      if (!whatsapp) whatsapp = teacher.phone ?? undefined;
      if (!avatarUrl) avatarUrl = teacher.avatarUrl ?? undefined;
    }

    const student = await studentRepo.findByUserId(request.user.id);
    if (student) {
      if (!fullName) fullName = student.fullName;
      if (!whatsapp) whatsapp = student.phone ?? undefined;
      cpf = student.cpf ?? undefined;
      if (!avatarUrl) avatarUrl = student.avatarUrl ?? undefined;
    }

    console.log('[GET /session] Sessao resolvida:', {
      userId: request.user.id,
      email: request.user.email,
      teacherFound: Boolean(teacher),
      studentFound: Boolean(student),
      resolvedRole: role,
    });

    return {
      data: {
        userId: request.user.id,
        email: request.user.email,
        fullName: fullName || null,
        whatsapp: whatsapp || null,
        cpf: cpf || null,
        avatarUrl: avatarUrl || null,
        role: role || 'student',
      },
    };
  });

  app.get('/student/flashcards/random', async (request, reply) => {
    if (!request.user) throw new Error('Authenticated user was not attached to request');

    const { monitorId, excludeFlashcardId } = request.query as { monitorId?: string; excludeFlashcardId?: string };

    // 1. Obter ou criar perfil de estudante para vincular progresso do SRS
    let student = await studentRepo.findByUserId(request.user.id);
    if (!student) {
      await prisma.student.create({
        data: {
          userId: request.user.id,
          fullName: request.user.fullName || 'Usuário',
          email: request.user.email || `${request.user.id}@meumonitor.ai`,
        },
      });
      student = await studentRepo.findByUserId(request.user.id);
    }
    if (!student) throw new Error('Falha ao obter perfil de estudante');

    // 2. Obter lista de monitores acessíveis (comprados/assinados ou criados pelo professor para testes)
    const subRecords = await prisma.studentSubscription.findMany({
      where: { studentId: student.id, status: 'active' },
      select: { monitorId: true },
    });
    const enrollRecords = await prisma.studentEnrollment.findMany({
      where: { studentId: student.id, status: 'ACTIVE' },
      select: { monitorId: true },
    });

    let teacherMonitorIds: string[] = [];
    const teacher = await prisma.teacher.findUnique({
      where: { userId: request.user.id },
      select: { id: true },
    });
    if (teacher) {
      const teacherMonitors = await prisma.monitor.findMany({
        where: { teacherId: teacher.id },
        select: { id: true },
      });
      teacherMonitorIds = teacherMonitors.map((m) => m.id);
    }

    const accessibleMonitorIds = Array.from(new Set([
      ...subRecords.map((s) => s.monitorId),
      ...enrollRecords.map((e) => e.monitorId),
      ...teacherMonitorIds,
    ]));

    if (accessibleMonitorIds.length === 0) {
      return reply.status(404).send({
        error: 'NO_ACCESSIBLE_MONITORS',
        message: 'Você não possui nenhum monitor de estudos comprado ou cadastrado.',
      });
    }

    // 3. Se um monitor específico foi solicitado, validar o acesso
    if (monitorId && !accessibleMonitorIds.includes(monitorId)) {
      return reply.status(403).send({
        error: 'MONITOR_NOT_ACCESSIBLE',
        message: 'Você não possui acesso a este monitor de estudos.',
      });
    }

    const activeMonitorIds = monitorId ? [monitorId] : accessibleMonitorIds;
    const monitorFilter = { monitorId: { in: activeMonitorIds } };
    const now = new Date();

    let targetFlashcard: any = null;
    let cardStatus: 'DUE' | 'NEW' | 'LEARNED' = 'NEW';

    // PRIORIDADE 1: Cards VENCIDOS para revisão (nextReviewAt <= agora)
    const dueProgresses = await prisma.studentFlashcardProgress.findMany({
      where: {
        studentId: student.id,
        nextReviewAt: { lte: now },
        flashcard: {
          ...monitorFilter,
          ...(excludeFlashcardId ? { id: { not: excludeFlashcardId } } : {}),
        },
      },
      orderBy: { nextReviewAt: 'asc' },
      include: {
        flashcard: {
          include: {
            subject: { select: { id: true, name: true } },
            topic: { select: { id: true, name: true } },
            monitor: { select: { id: true, name: true } },
          },
        },
      },
    });

    const dueProgress = pickRandomAvailable(dueProgresses, excludeFlashcardId, Math.random, (progress) => progress.flashcard.id);

    if (dueProgress) {
      targetFlashcard = dueProgress.flashcard;
      cardStatus = 'DUE';
    } else {
      // PRIORIDADE 2: Cards NOVOS (nunca respondidos pelo aluno)
      const unreviewedCards = await prisma.flashcard.findMany({
        where: {
          ...monitorFilter,
          ...(excludeFlashcardId ? { id: { not: excludeFlashcardId } } : {}),
          progresses: {
            none: { studentId: student.id },
          },
        },
        include: {
          subject: { select: { id: true, name: true } },
          topic: { select: { id: true, name: true } },
          monitor: { select: { id: true, name: true } },
        },
      });

      const unreviewedCard = pickRandomAvailable(unreviewedCards, excludeFlashcardId);

      if (unreviewedCard) {
        targetFlashcard = unreviewedCard;
        cardStatus = 'NEW';
      }
    }

    // FALLBACK: Se não houver pendentes no SRS, pegar um flashcard aleatório dos monitores permitidos
    if (!targetFlashcard) {
      const fallbackCards = await prisma.flashcard.findMany({
        where: {
          ...monitorFilter,
          ...(excludeFlashcardId ? { id: { not: excludeFlashcardId } } : {}),
        },
        include: {
          subject: { select: { id: true, name: true } },
          topic: { select: { id: true, name: true } },
          monitor: { select: { id: true, name: true } },
        },
        take: 50,
      });

      if (fallbackCards.length > 0) {
        targetFlashcard = pickRandomAvailable(fallbackCards, excludeFlashcardId);
        cardStatus = 'LEARNED';
      }
    }

    // Se o monitor possui somente o card atual, não deixar a sessão sem card.
    if (!targetFlashcard && excludeFlashcardId) {
      const onlyAvailableCard = await prisma.flashcard.findFirst({
        where: { ...monitorFilter, id: excludeFlashcardId },
        include: {
          subject: { select: { id: true, name: true } },
          topic: { select: { id: true, name: true } },
          monitor: { select: { id: true, name: true } },
        },
      });

      if (onlyAvailableCard) {
        targetFlashcard = onlyAvailableCard;
        cardStatus = 'LEARNED';
      }
    }

    if (!targetFlashcard) {
      return reply.status(404).send({
        error: 'NO_FLASHCARDS_FOUND',
        message: 'Nenhum flashcard disponível para este monitor no momento.',
      });
    }

    console.log('[GET /student/flashcards/random] Flashcard selecionado:', {
      id: targetFlashcard.id,
      front: targetFlashcard.front,
      cardStatus,
      studentId: student.id,
    });

    const subjectName = targetFlashcard.subject?.name || 'Geral';
    const topicName = targetFlashcard.topic?.name || '';
    return reply.send({
      data: {
        id: targetFlashcard.id,
        monitorId: targetFlashcard.monitorId,
        subjectId: targetFlashcard.subjectId,
        topicId: targetFlashcard.topicId,
        subject: topicName ? `${subjectName} • ${topicName}` : subjectName,
        topic: topicName || 'Geral',
        monitorName: targetFlashcard.monitor?.name || 'Meu Monitor AI',
        question: targetFlashcard.front,
        answer: targetFlashcard.back,
        cardStatus,
      },
    });
  });

  app.post('/student/monitors/:monitorId/cancel', async (request, reply) => {
    if (!request.user) throw new Error('Authenticated user was not attached to request');

    const { monitorId } = request.params as { monitorId: string };
    const student = await studentRepo.findByUserId(request.user.id);
    if (!student) return reply.status(404).send({ error: 'STUDENT_NOT_FOUND', message: 'Estudante não encontrado.' });

    await prisma.studentSubscription.updateMany({
      where: { studentId: student.id, monitorId, status: 'active' },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });

    await prisma.studentEnrollment.updateMany({
      where: { studentId: student.id, monitorId, status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    });

    console.log('[POST /student/monitors/:monitorId/cancel] Assinatura cancelada:', {
      studentId: student.id,
      monitorId,
    });

    return reply.send({ success: true, message: 'Assinatura cancelada com sucesso.' });
  });

  app.post('/student/flashcards/:flashcardId/review', async (request, reply) => {
    if (!request.user) throw new Error('Authenticated user was not attached to request');

    const { flashcardId } = request.params as { flashcardId: string };
    const { rating } = request.body as { rating: 'AGAIN' | 'HARD' | 'GOOD' | 'EASY' };

    const validRatings = ['AGAIN', 'HARD', 'GOOD', 'EASY'];
    if (!rating || !validRatings.includes(rating)) {
      return reply.status(400).send({
        error: 'INVALID_RATING',
        message: 'Rating inválido. Escolha entre AGAIN, HARD, GOOD ou EASY.',
      });
    }

    let student = await studentRepo.findByUserId(request.user.id);
    if (!student) {
      await prisma.student.create({
        data: {
          userId: request.user.id,
          fullName: request.user.fullName || 'Usuário',
          email: request.user.email || `${request.user.id}@meumonitor.ai`,
        },
      });
      student = await studentRepo.findByUserId(request.user.id);
    }
    if (!student) throw new Error('Falha ao obter perfil de estudante');

    const flashcard = await prisma.flashcard.findUnique({
      where: { id: flashcardId },
    });

    if (!flashcard) {
      return reply.status(404).send({ error: 'FLASHCARD_NOT_FOUND', message: 'Flashcard não encontrado.' });
    }

    // Verificar se o usuário comprou ou é dono do monitor deste flashcard (conta teste de professor)
    const subRecord = await prisma.studentSubscription.findFirst({
      where: { studentId: student.id, monitorId: flashcard.monitorId, status: 'active' },
    });
    const enrollRecord = await prisma.studentEnrollment.findFirst({
      where: { studentId: student.id, monitorId: flashcard.monitorId, status: 'ACTIVE' },
    });

    let isOwnerTeacher = false;
    const teacher = await prisma.teacher.findUnique({
      where: { userId: request.user.id },
      select: { id: true },
    });
    if (teacher && flashcard.teacherId === teacher.id) {
      isOwnerTeacher = true;
    }

    if (!subRecord && !enrollRecord && !isOwnerTeacher) {
      return reply.status(403).send({
        error: 'MONITOR_NOT_ACCESSIBLE',
        message: 'Você não possui acesso aos flashcards deste monitor.',
      });
    }

    // Obter ou inicializar o progresso SRS do aluno para este flashcard
    const currentProgress = await prisma.studentFlashcardProgress.findUnique({
      where: {
        studentId_flashcardId: {
          studentId: student.id,
          flashcardId: flashcard.id,
        },
      },
    });

    const now = new Date();
    const srsResult = calculateNextSrsState(currentProgress, rating, now);

    // Salvar/Atualizar estado do progresso SRS
    const updatedProgress = await prisma.studentFlashcardProgress.upsert({
      where: {
        studentId_flashcardId: {
          studentId: student.id,
          flashcardId: flashcard.id,
        },
      },
      update: {
        lastRating: rating,
        repetitions: srsResult.repetitions,
        intervalDays: srsResult.intervalDays,
        easeFactor: srsResult.easeFactor,
        lastReviewedAt: now,
        nextReviewAt: srsResult.nextReviewAt,
      },
      create: {
        studentId: student.id,
        flashcardId: flashcard.id,
        lastRating: rating,
        repetitions: srsResult.repetitions,
        intervalDays: srsResult.intervalDays,
        easeFactor: srsResult.easeFactor,
        lastReviewedAt: now,
        nextReviewAt: srsResult.nextReviewAt,
      },
    });

    // Registrar log histórico de revisão
    await prisma.studentFlashcardReviewLog.create({
      data: {
        studentId: student.id,
        flashcardId: flashcard.id,
        rating,
        intervalDays: srsResult.intervalDays,
        easeFactor: srsResult.easeFactor,
        reviewedAt: now,
        nextReviewAt: srsResult.nextReviewAt,
      },
    });

    console.log('\n======================================================');
    console.log('🎴 [FLASHCARD REVIEW RECEBIDA NO BACKEND]');
    console.log(`👤 Estudante ID : ${student.id}`);
    console.log(`📌 Flashcard ID : ${flashcard.id}`);
    console.log(`🏷️ Pergunta     : "${flashcard.front}"`);
    console.log(`⭐ Avaliação    : ${rating}`);
    console.log(`🔄 Repetições   : ${srsResult.repetitions}`);
    console.log(`⏱️ Intervalo    : ${srsResult.intervalDays} dias`);
    console.log(`📅 Próxima Rev. : ${srsResult.nextReviewAt.toLocaleString('pt-BR')}`);
    console.log('======================================================\n');

    return reply.send({
      success: true,
      data: {
        flashcardId: flashcard.id,
        rating,
        repetitions: updatedProgress.repetitions,
        intervalDays: updatedProgress.intervalDays,
        easeFactor: updatedProgress.easeFactor,
        nextReviewAt: updatedProgress.nextReviewAt,
      },
    });
  });
}

