import { prisma } from '../lib/prisma.js';
import type { CreateMonitorInput } from '../models/monitor.model.js';

export class MonitorRepository {
  private readonly monitorTree = {
    teacher: true,
    subjects: {
      orderBy: { position: 'asc' as const },
      include: { topics: { orderBy: { position: 'asc' as const } } },
    },
    _count: {
      select: {
        questions: { where: { status: 'APPROVED' as const } },
        flashcards: { where: { status: 'APPROVED' as const } },
        documents: true,
      },
    },
  };

  async createDraft(userId: string, input: CreateMonitorInput) {
    const teacher = await prisma.teacher.findUnique({
      where: { userId },
      select: { id: true, status: true },
    });

    if (!teacher) return { kind: 'TEACHER_NOT_FOUND' as const };
    if (teacher.status !== 'active') return { kind: 'TEACHER_NOT_ACTIVE' as const };

    const monitor = await prisma.monitor.create({
      data: {
        teacherId: teacher.id,
        name: input.name,
        description: input.description || null,
        status: 'DRAFT',
        subjects: {
          create: input.subjects.map((subject, subjectIndex) => ({
            name: subject.name,
            position: subjectIndex,
            topics: {
              create: subject.topics.map((topic, topicIndex) => ({
                name: topic.name,
                definition: topic.definition || null,
                definitionOrigin: topic.definition ? 'TEACHER' : null,
                definitionUpdatedAt: topic.definition ? new Date() : null,
                position: topicIndex,
              })),
            },
          })),
        },
      },
      include: {
        ...this.monitorTree,
      },
    });

    return { kind: 'CREATED' as const, monitor };
  }

  async findAllOwnedByUserId(userId: string) {
    console.log('[MonitorRepository.findAllOwnedByUserId] Iniciando busca de monitores para userId:', userId);
    const teacher = await prisma.teacher.findUnique({ where: { userId } });
    console.log('[MonitorRepository.findAllOwnedByUserId] Registro de professor encontrado:', {
      userId,
      teacherFound: Boolean(teacher),
      teacherId: teacher?.id,
      teacherEmail: teacher?.email,
    });

    const monitors = await prisma.monitor.findMany({
      where: {
        OR: [
          { teacher: { userId } },
          ...(teacher ? [{ teacherId: teacher.id }] : []),
        ],
      },
      include: this.monitorTree,
      orderBy: { updatedAt: 'desc' },
    });

    console.log('[MonitorRepository.findAllOwnedByUserId] Monitores retornados do DB:', {
      userId,
      count: monitors.length,
      monitors: monitors.map((m) => ({ id: m.id, name: m.name, status: m.status })),
    });

    return monitors;
  }

  async findOwnedByUserId(userId: string, monitorId: string) {
    return prisma.monitor.findFirst({
      where: { id: monitorId, teacher: { userId } },
      include: this.monitorTree,
    });
  }

  async addSubject(userId: string, monitorId: string, name: string, topics: string[] = []) {
    const monitor = await prisma.monitor.findFirst({
      where: { id: monitorId, teacher: { userId } },
      include: { subjects: { orderBy: { position: 'asc' } } },
    });
    if (!monitor) return null;

    const nextPosition = monitor.subjects.length > 0
      ? Math.max(...monitor.subjects.map((s) => s.position)) + 1
      : 0;

    const validTopics = topics.map((t) => t.trim()).filter((t) => t.length > 0);

    await prisma.monitorSubject.create({
      data: {
        monitorId,
        name: name.trim(),
        position: nextPosition,
        topics: {
          create: validTopics.map((topicName, idx) => ({
            name: topicName,
            position: idx,
          })),
        },
      },
    });

    return this.findOwnedByUserId(userId, monitorId);
  }

  async deleteSubject(userId: string, monitorId: string, subjectId: string) {
    const monitor = await prisma.monitor.findFirst({
      where: { id: monitorId, teacher: { userId } },
    });
    if (!monitor) return null;

    await prisma.monitorSubject.deleteMany({
      where: { id: subjectId, monitorId },
    });

    return this.findOwnedByUserId(userId, monitorId);
  }

  async addTopic(userId: string, monitorId: string, subjectId: string, name: string, definition?: string) {
    const subject = await prisma.monitorSubject.findFirst({
      where: { id: subjectId, monitorId, monitor: { teacher: { userId } } },
      include: { topics: { orderBy: { position: 'asc' } } },
    });
    if (!subject) return null;

    const nextPosition = subject.topics.length > 0
      ? Math.max(...subject.topics.map((t) => t.position)) + 1
      : 0;

    await prisma.monitorTopic.create({
      data: {
        subjectId,
        name: name.trim(),
        definition: definition?.trim() || null,
        definitionOrigin: definition?.trim() ? 'TEACHER' : null,
        definitionUpdatedAt: definition?.trim() ? new Date() : null,
        position: nextPosition,
      },
    });

    return this.findOwnedByUserId(userId, monitorId);
  }

  async deleteTopic(userId: string, monitorId: string, subjectId: string, topicId: string) {
    const subject = await prisma.monitorSubject.findFirst({
      where: { id: subjectId, monitorId, monitor: { teacher: { userId } } },
    });
    if (!subject) return null;

    await prisma.monitorTopic.deleteMany({
      where: { id: topicId, subjectId },
    });

    return this.findOwnedByUserId(userId, monitorId);
  }

  async update(
    userId: string,
    monitorId: string,
    data: {
      name?: string;
      description?: string | null;
      avatarUrl?: string | null;
      detailedDescription?: string | null;
      status?: 'DRAFT' | 'READY_TO_PUBLISH' | 'PUBLISHED' | 'PAUSED' | 'ARCHIVED';
    }
  ) {
    const monitor = await prisma.monitor.findFirst({
      where: { id: monitorId, teacher: { userId } },
    });
    if (!monitor) return null;

    await prisma.monitor.update({
      where: { id: monitorId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        description: data.description !== undefined ? data.description : undefined,
        avatarUrl: data.avatarUrl !== undefined ? data.avatarUrl : undefined,
        detailedDescription: data.detailedDescription !== undefined ? data.detailedDescription : undefined,
        ...(data.status !== undefined ? { status: data.status, publishedAt: data.status === 'PUBLISHED' ? new Date() : undefined } : {}),
      },
    });

    return this.findOwnedByUserId(userId, monitorId);
  }
}
