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
    questions: {
      where: { status: 'REPORTED' as const },
      select: { id: true },
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

  async getQuestionBankCatalog() {
    const rows = await prisma.$queryRaw<Array<{
      board_name: string;
      exam_type: string;
      subject: string;
      topic: string;
      subtopic: string | null;
      subsubtopic: string | null;
      count: number;
    }>>`
      SELECT 
        COALESCE(NULLIF(board, ''), NULLIF(institution, ''), NULLIF(exam_type, ''), 'ENEM') as board_name,
        COALESCE(NULLIF(exam_type, ''), 'ENEM') as exam_type,
        subject,
        topic,
        subtopic,
        subsubtopic,
        COUNT(*)::int as count
      FROM question_bank_items
      WHERE status != 'DELETED'
      GROUP BY COALESCE(NULLIF(board, ''), NULLIF(institution, ''), NULLIF(exam_type, ''), 'ENEM'), COALESCE(NULLIF(exam_type, ''), 'ENEM'), subject, topic, subtopic, subsubtopic
      ORDER BY subject, topic, subtopic, subsubtopic
    `;

    return this.buildTaxonomyFromQuestionBank(rows);
  }

  private buildTaxonomyFromQuestionBank(rows: Array<{
    board_name: string;
    exam_type: string;
    subject: string;
    topic: string;
    subtopic: string | null;
    subsubtopic: string | null;
    count: number;
  }>) {
    let totalQuestions = 0;
    const examProfilesMap = new Map<string, {
      id: string;
      name: string;
      category: string;
      description: string;
      badge: string;
      questionCount: number;
    }>();

    const subjectsMap = new Map<string, {
      id: string;
      name: string;
      category: string;
      totalQuestions: number;
      examProfileIds: Set<string>;
      topicsMap: Map<string, {
        id: string;
        name: string;
        totalQuestions: number;
        subtopicsMap: Map<string, {
          id: string;
          name: string;
          questionCount: number;
          subsubtopicsMap: Map<string, {
            id: string;
            name: string;
            questionCount: number;
          }>;
        }>;
      }>;
    }>();

    for (const row of rows) {
      const rowCount = Number(row.count) || 0;
      totalQuestions += rowCount;

      // Agregação de Perfis de Prova & Bancas
      const rawExamName = (row.board_name || row.exam_type || 'ENEM').trim();
      const examKey = rawExamName.toUpperCase();
      const profileId = rawExamName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (!examProfilesMap.has(examKey)) {
        examProfilesMap.set(examKey, {
          id: profileId,
          name: rawExamName,
          category: this.inferExamCategory(rawExamName),
          description: this.inferExamDescription(rawExamName),
          badge: this.inferExamBadge(rawExamName),
          questionCount: 0,
        });
      }
      const prof = examProfilesMap.get(examKey)!;
      prof.questionCount += rowCount;

      // Agregação por Matéria (Subject)
      const subjectName = (row.subject || 'Geral').trim();
      if (!subjectsMap.has(subjectName)) {
        subjectsMap.set(subjectName, {
          id: subjectName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          name: subjectName,
          category: this.inferSubjectCategory(subjectName),
          totalQuestions: 0,
          examProfileIds: new Set<string>(),
          topicsMap: new Map(),
        });
      }
      const subj = subjectsMap.get(subjectName)!;
      subj.totalQuestions += rowCount;
      subj.examProfileIds.add(profileId);

      // Agregação por Tópico (Topic)
      const topicName = (row.topic || 'Geral').trim();
      if (!subj.topicsMap.has(topicName)) {
        subj.topicsMap.set(topicName, {
          id: `${subj.id}-${topicName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          name: topicName,
          totalQuestions: 0,
          subtopicsMap: new Map(),
        });
      }
      const topicObj = subj.topicsMap.get(topicName)!;
      topicObj.totalQuestions += rowCount;

      // Agregação por Subtópico (Subtopic) e Subsubtópico (Subsubtopic)
      const rawSubtopic = (row.subtopic || '').trim();
      const rawSubsubtopic = (row.subsubtopic || '').trim();

      const subtopicName = rawSubtopic || (rawSubsubtopic ? topicName : 'Geral');
      const subtopicId = `${topicObj.id}-${subtopicName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

      if (!topicObj.subtopicsMap.has(subtopicName)) {
        topicObj.subtopicsMap.set(subtopicName, {
          id: subtopicId,
          name: subtopicName,
          questionCount: 0,
          subsubtopicsMap: new Map(),
        });
      }
      const subtopicObj = topicObj.subtopicsMap.get(subtopicName)!;
      subtopicObj.questionCount += rowCount;

      if (rawSubsubtopic) {
        const subsubtopicId = `${subtopicId}-${rawSubsubtopic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        if (!subtopicObj.subsubtopicsMap.has(rawSubsubtopic)) {
          subtopicObj.subsubtopicsMap.set(rawSubsubtopic, {
            id: subsubtopicId,
            name: rawSubsubtopic,
            questionCount: 0,
          });
        }
        const subsubObj = subtopicObj.subsubtopicsMap.get(rawSubsubtopic)!;
        subsubObj.questionCount += rowCount;
      }
    }

    const examProfiles = Array.from(examProfilesMap.values()).filter((p) => p.questionCount > 0);

    const subjects = Array.from(subjectsMap.values()).map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      totalQuestions: s.totalQuestions,
      examProfileIds: Array.from(s.examProfileIds),
      topics: Array.from(s.topicsMap.values()).map((t) => ({
        id: t.id,
        name: t.name,
        totalQuestions: t.totalQuestions,
        subtopics: Array.from(t.subtopicsMap.values()).map((st) => ({
          id: st.id,
          name: st.name,
          questionCount: st.questionCount,
          subsubtopics: Array.from(st.subsubtopicsMap.values()).map((sst) => ({
            id: sst.id,
            name: sst.name,
            questionCount: sst.questionCount,
          })),
        })),
      })),
    }));

    return {
      totalQuestions,
      examProfiles,
      subjects,
    };
  }

  private inferExamCategory(name: string): string {
    const s = name.toLowerCase();
    if (s.includes('enem') || s.includes('vestibular') || s.includes('fuvest') || s.includes('unicamp') || s.includes('vunesp') || s.includes('uerj') || s.includes('uf')) {
      return 'Vestibulares & ENEM';
    }
    if (s.includes('cebraspe') || s.includes('cespe') || s.includes('fgv') || s.includes('fcc') || s.includes('cesgranrio') || s.includes('quadrix') || s.includes('concurso')) {
      return 'Concursos Públicos';
    }
    if (s.includes('ita') || s.includes('ime') || s.includes('espcex') || s.includes('afa') || s.includes('militar')) {
      return 'Militares & Técnicos';
    }
    if (s.includes('oab') || s.includes('policia') || s.includes('pf') || s.includes('prf') || s.includes('magistratura') || s.includes('defensoria')) {
      return 'Carreiras Jurídicas & OAB';
    }
    if (s.includes('med') || s.includes('enare') || s.includes('residencia') || s.includes('sus') || s.includes('saude')) {
      return 'Saúde & Residência';
    }
    return 'Geral';
  }

  private inferExamDescription(name: string): string {
    const s = name.toLowerCase();
    if (s.includes('enem')) {
      return 'Exame Nacional do Ensino Médio — Questões oficiais do banco com matriz de habilidades.';
    }
    if (s.includes('fuvest')) {
      return 'Universidade de São Paulo — Questões conceituais clássicas e discursivas.';
    }
    if (s.includes('cebraspe') || s.includes('cespe')) {
      return 'Banca Cebraspe — Padrão Certo/Errado com penalização por erro e múltipla escolha.';
    }
    if (s.includes('fgv')) {
      return 'Fundação Getulio Vargas — Casos práticos, português aprofundado e raciocínio analítico.';
    }
    return `Questões oficiais e catalogadas da banca/exame ${name}.`;
  }

  private inferExamBadge(name: string): string {
    const s = name.toLowerCase();
    if (s.includes('enem')) return 'Nacional';
    if (s.length <= 8) return name.toUpperCase();
    return 'Oficial';
  }

  private inferSubjectCategory(subject: string): string {
    const s = subject.toLowerCase();
    if (s.includes('matemática') || s.includes('física') || s.includes('estatística') || s.includes('raciocínio')) return 'Ciências Exatas';
    if (s.includes('biologia') || s.includes('química') || s.includes('natureza')) return 'Ciências da Natureza';
    if (s.includes('português') || s.includes('literatura') || s.includes('redação') || s.includes('inglês') || s.includes('espanhol')) return 'Linguagens';
    if (s.includes('história') || s.includes('geografia') || s.includes('filosofia') || s.includes('sociologia') || s.includes('humanas')) return 'Ciências Humanas';
    if (s.includes('direito') || s.includes('administração') || s.includes('legislação')) return 'Carreiras & Concursos';
    return 'Geral';
  }
}

