import { prisma } from '../lib/prisma.js';
import type { CreateMonitorInput } from '../models/monitor.model.js';
import {
  buildMonitorTopicName,
  buildMonitorTopicHierarchy,
  normalizeQuestionBankSelection,
  normalizeTaxonomyName,
} from '../modules/question-bank/services/question-bank-selection.service.js';
import {
  canPublishMonitor,
  isPaymentAccountEligible,
} from '../modules/payments/application/queries/get-payout-eligibility.use-case.js';

export class MonitorPublicationBlockedError extends Error {
  constructor() {
    super('PAYMENT_ACCOUNT_REQUIRED_FOR_PUBLICATION');
  }
}

export class MonitorRepository {
  async findTeacherPageSlugByMonitorId(monitorId: string) {
    const monitor = await prisma.monitor.findUnique({
      where: { id: monitorId },
      select: { teacher: { select: { pageSlug: true } } },
    });
    return monitor?.teacher.pageSlug ?? null;
  }

  private readonly monitorTree = {
    teacher: true,
    subjects: {
      orderBy: { position: 'asc' as const },
      include: {
        topics: {
          orderBy: { position: 'asc' as const },
          include: {
            questionBankSelections: { orderBy: { createdAt: 'asc' as const } },
            subtopics: {
              orderBy: { position: 'asc' as const },
              include: {
                questionBankSelections: { orderBy: { createdAt: 'asc' as const } },
                subsubtopics: {
                  orderBy: { position: 'asc' as const },
                  include: { questionBankSelections: { orderBy: { createdAt: 'asc' as const } } },
                },
              },
            },
          },
        },
      },
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
      select: {
        id: true,
        status: true,
        currentPaymentAccount: { select: { status: true, generalStatus: true } },
      },
    });

    if (!teacher) return { kind: 'TEACHER_NOT_FOUND' as const };
    if (teacher.status !== 'active') return { kind: 'TEACHER_NOT_ACTIVE' as const };
    if (!isPaymentAccountEligible(teacher.currentPaymentAccount)) {
      return { kind: 'PAYMENT_ACCOUNT_REQUIRED' as const };
    }

    const normalizedSelections = Array.from(
      new Map(
        (input.questionBankSelections ?? [])
          .map(normalizeQuestionBankSelection)
          .map((selection) => [selection.selectionKey, selection] as const),
      ).values(),
    );

    console.log('Preparando criação transacional do Monitor', {
      event: 'monitor.create_transaction_started',
      userId,
      teacherId: teacher.id,
      monitorInput: {
        name: input.name,
        description: input.description ?? null,
        subjects: input.subjects,
      },
      normalizedSelections,
    });

    const monitor = await prisma.$transaction(async (transaction) => {
        const createdMonitor = await transaction.monitor.create({
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
                  create: buildMonitorTopicHierarchy(subject.topics).map((topic) => ({
                    name: topic.name,
                    definition: topic.definition || null,
                    definitionOrigin: topic.definition ? 'TEACHER' : null,
                    definitionUpdatedAt: topic.definition ? new Date() : null,
                    position: topic.position,
                    subtopics: {
                      create: topic.subtopics.map((subtopic) => ({
                        name: subtopic.name,
                        position: subtopic.position,
                        subsubtopics: {
                          create: subtopic.subsubtopics.map((subsubtopic) => ({
                            name: subsubtopic.name,
                            position: subsubtopic.position,
                          })),
                        },
                      })),
                    },
                  })),
                },
              })),
            },
          },
        });

        if (normalizedSelections.length > 0) {
          const localSubjects = await transaction.monitorSubject.findMany({
            where: { monitorId: createdMonitor.id },
            include: { topics: { include: { subtopics: { include: { subsubtopics: true } } } } },
          });
          const subjectMap = new Map(localSubjects.map((subject) => [normalizeTaxonomyName(subject.name), subject]));

          const selectionRows = normalizedSelections.map((selection) => {
            const localSubject = subjectMap.get(normalizeTaxonomyName(selection.subject));
            const localTopicName = buildMonitorTopicName(selection);
            const localTopic = localSubject?.topics.find(
              (topic) => normalizeTaxonomyName(topic.name) === normalizeTaxonomyName(selection.topic),
            );
            const localSubtopic = selection.subtopic
              ? localTopic?.subtopics.find((subtopic) => normalizeTaxonomyName(subtopic.name) === normalizeTaxonomyName(selection.subtopic))
              : null;
            const localSubsubtopic = selection.subsubtopic
              ? localSubtopic?.subsubtopics.find((subsubtopic) => normalizeTaxonomyName(subsubtopic.name) === normalizeTaxonomyName(selection.subsubtopic))
              : null;

            if (!localSubject || !localTopic || (selection.subtopic && !localSubtopic) || (selection.subsubtopic && !localSubsubtopic)) {
              throw new Error(`QUESTION_BANK_SELECTION_TOPIC_NOT_FOUND: ${selection.subject} / ${localTopicName}`);
            }

            return {
              monitorTopicId: localTopic.id,
              monitorSubtopicId: localSubtopic?.id ?? null,
              monitorSubsubtopicId: localSubsubtopic?.id ?? null,
              examType: selection.examType,
              board: selection.board,
              subtopic: selection.subtopic,
              subsubtopic: selection.subsubtopic,
              selectionKey: selection.selectionKey,
            };
          });

          await transaction.monitorQuestionBankSelection.createMany({ data: selectionRows });
          console.log('Seleções do acervo associadas aos tópicos locais', {
            event: 'monitor.question_bank_selections_persisted',
            monitorId: createdMonitor.id,
            selectionCount: selectionRows.length,
            selections: selectionRows,
          });
        }

        return transaction.monitor.findUniqueOrThrow({
          where: { id: createdMonitor.id },
          include: this.monitorTree,
        });
    }, { maxWait: 10_000, timeout: 60_000 });

    console.log('Criação transacional do Monitor concluída', {
      event: 'monitor.create_transaction_completed',
      monitorId: monitor.id,
      status: monitor.status,
      subjectCount: monitor.subjects.length,
      topicCount: monitor.subjects.reduce((total, subject) => total + subject.topics.length, 0),
      selectionCount: monitor.subjects.reduce(
        (total, subject) => total + subject.topics.reduce((topicTotal, topic) => topicTotal + topic.questionBankSelections.length, 0),
        0,
      ),
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

    if (!teacher) return [];

    const monitors = await prisma.monitor.findMany({
      where: { teacherId: teacher.id },
      select: {
        id: true,
        teacherId: true,
        name: true,
        description: true,
        detailedDescription: true,
        priceCents: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (monitors.length === 0) return [];

    const monitorIds = monitors.map((monitor) => monitor.id);
    const [subjects, counts, reportedQuestions] = await Promise.all([
      prisma.monitorSubject.findMany({
        where: { monitorId: { in: monitorIds } },
        select: {
          id: true,
          monitorId: true,
          name: true,
          position: true,
          topics: {
            select: {
              id: true,
              name: true,
              definition: true,
              classificationGuidance: true,
              position: true,
            },
          },
        },
      }),
      prisma.monitor.findMany({
        where: { id: { in: monitorIds } },
        select: {
          id: true,
          _count: {
            select: {
              questions: { where: { status: 'APPROVED' } },
              flashcards: { where: { status: 'APPROVED' } },
              documents: true,
            },
          },
        },
      }),
      prisma.question.findMany({
        where: { monitorId: { in: monitorIds }, status: 'REPORTED' },
        select: { id: true, monitorId: true },
      }),
    ]);

    const subjectsByMonitor = new Map<string, typeof subjects>();
    for (const subject of subjects) {
      const current = subjectsByMonitor.get(subject.monitorId) ?? [];
      current.push(subject);
      subjectsByMonitor.set(subject.monitorId, current);
    }
    const countsByMonitor = new Map(counts.map((item) => [item.id, item._count]));
    const reportedByMonitor = new Map<string, Array<{ id: string }>>();
    for (const question of reportedQuestions) {
      const current = reportedByMonitor.get(question.monitorId) ?? [];
      current.push({ id: question.id });
      reportedByMonitor.set(question.monitorId, current);
    }

    monitors.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
    const monitorsWithSummary = monitors.map((monitor) => ({
      ...monitor,
      subjects: (subjectsByMonitor.get(monitor.id) ?? [])
        .sort((left, right) => left.position - right.position)
        .map((subject) => ({
          ...subject,
          topics: subject.topics.sort((left, right) => left.position - right.position),
        })),
      _count: countsByMonitor.get(monitor.id) ?? { questions: 0, flashcards: 0, documents: 0 },
      questions: reportedByMonitor.get(monitor.id) ?? [],
    }));

    console.log('[MonitorRepository.findAllOwnedByUserId] Monitores retornados do DB:', {
      userId,
      count: monitorsWithSummary.length,
      monitors: monitorsWithSummary.map((m) => ({ id: m.id, name: m.name, status: m.status })),
    });

    return monitorsWithSummary;
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
          create: buildMonitorTopicHierarchy(validTopics.map((topicName) => ({ name: topicName }))).map((topic) => ({
            name: topic.name,
            position: topic.position,
            subtopics: {
              create: topic.subtopics.map((subtopic) => ({
                name: subtopic.name,
                position: subtopic.position,
                subsubtopics: {
                  create: subtopic.subsubtopics.map((subsubtopic) => ({
                    name: subsubtopic.name,
                    position: subsubtopic.position,
                  })),
                },
              })),
            },
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
      include: {
        topics: {
          orderBy: { position: 'asc' },
          include: { subtopics: { orderBy: { position: 'asc' }, include: { subsubtopics: { orderBy: { position: 'asc' } } } } },
        },
      },
    });
    if (!subject) return null;

    const hierarchy = buildMonitorTopicHierarchy([{ name, definition }]);
    const root = hierarchy[0];
    if (!root) return this.findOwnedByUserId(userId, monitorId);

    const existingTopic = subject.topics.find((topic) => normalizeTaxonomyName(topic.name) === normalizeTaxonomyName(root.name));
    if (!existingTopic) {
      const nextPosition = subject.topics.length > 0
        ? Math.max(...subject.topics.map((topic) => topic.position)) + 1
        : 0;
      await prisma.monitorTopic.create({
        data: {
          subjectId,
          name: root.name,
          definition: root.definition,
          definitionOrigin: root.definition ? 'TEACHER' : null,
          definitionUpdatedAt: root.definition ? new Date() : null,
          position: nextPosition,
          subtopics: {
            create: root.subtopics.map((subtopic) => ({
              name: subtopic.name,
              position: subtopic.position,
              subsubtopics: {
                create: subtopic.subsubtopics.map((subsubtopic) => ({ name: subsubtopic.name, position: subsubtopic.position })),
              },
            })),
          },
        },
      });
    } else {
      const localTopic = existingTopic;
      for (const subtopic of root.subtopics) {
        const existingSubtopic = localTopic.subtopics.find((candidate) => normalizeTaxonomyName(candidate.name) === normalizeTaxonomyName(subtopic.name));
        let localSubtopicId: string;
        let existingSubsubtopicNames: string[];
        if (!existingSubtopic) {
          const createdSubtopic = await prisma.monitorSubtopic.create({
            data: {
              monitorTopicId: localTopic.id,
              name: subtopic.name,
              position: localTopic.subtopics.length,
            },
          });
          localSubtopicId = createdSubtopic.id;
          existingSubsubtopicNames = [];
        } else {
          localSubtopicId = existingSubtopic.id;
          existingSubsubtopicNames = existingSubtopic.subsubtopics.map((candidate) => normalizeTaxonomyName(candidate.name));
        }
        for (const subsubtopic of subtopic.subsubtopics) {
          if (!existingSubsubtopicNames.includes(normalizeTaxonomyName(subsubtopic.name))) {
            await prisma.monitorSubsubtopic.create({
              data: {
                monitorSubtopicId: localSubtopicId,
                name: subsubtopic.name,
                position: existingSubsubtopicNames.length,
              },
            });
            existingSubsubtopicNames.push(normalizeTaxonomyName(subsubtopic.name));
          }
        }
      }
    }

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

    if (data.status === 'PUBLISHED' && !monitor.allowPublishWithoutPaymentAccount) {
      const teacher = await prisma.teacher.findUnique({
        where: { id: monitor.teacherId },
        select: { currentPaymentAccount: { select: { status: true, generalStatus: true } } },
      });
      if (!canPublishMonitor({ allowPublishWithoutPaymentAccount: monitor.allowPublishWithoutPaymentAccount, account: teacher?.currentPaymentAccount ?? null })) {
        throw new MonitorPublicationBlockedError();
      }
    }

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

  async setPublicationException(monitorId: string, allowed: boolean) {
    return prisma.monitor.update({ where: { id: monitorId }, data: { allowPublishWithoutPaymentAccount: allowed } });
  }

  async getQuestionBankCatalog() {
    const rows = await prisma.$queryRaw<Array<{
      board: string | null;
      exam_type: string;
      subject: string;
      topic: string;
      subtopic: string | null;
      subsubtopic: string | null;
      count: number;
    }>>`
      SELECT 
        NULLIF(board, '') as board,
        COALESCE(NULLIF(exam_type, ''), 'ENEM') as exam_type,
        subject,
        topic,
        subtopic,
        subsubtopic,
        COUNT(*)::int as count
      FROM question_bank_items
      WHERE status != 'DELETED'
      GROUP BY NULLIF(board, ''), COALESCE(NULLIF(exam_type, ''), 'ENEM'), subject, topic, subtopic, subsubtopic
      ORDER BY subject, topic, subtopic, subsubtopic
    `;

    return this.buildTaxonomyFromQuestionBank(rows);
  }

  private buildTaxonomyFromQuestionBank(rows: Array<{
    board: string | null;
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
      examType: string;
      board: string | null;
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
      const rawExamType = (row.exam_type || 'ENEM').trim().toUpperCase();
      const rawBoard = row.board?.trim() || null;
      const rawExamName = rawBoard || rawExamType;
      const examKey = `${rawExamType}|${rawBoard || ''}`;
      const profileId = `${rawExamType}${rawBoard ? `-${rawBoard}` : ''}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (!examProfilesMap.has(examKey)) {
        examProfilesMap.set(examKey, {
          id: profileId,
          name: rawExamName,
          examType: rawExamType,
          board: rawBoard,
          category: this.inferExamCategory(`${rawExamType} ${rawExamName}`),
          description: this.inferExamDescription(`${rawExamType} ${rawExamName}`),
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
