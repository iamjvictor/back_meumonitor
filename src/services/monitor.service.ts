import type { CreateMonitorInput } from '../models/monitor.model.js';
import { normalizeQuestionBankSelection } from '../modules/question-bank/services/question-bank-selection.service.js';
import { QuestionBankMaterializationService } from '../modules/question-bank/services/question-bank-materialization.service.js';
import { MonitorRepository } from '../repositories/monitor.repository.js';

export class MonitorService {
  constructor(
    private readonly repository: MonitorRepository,
    private readonly materializationService: QuestionBankMaterializationService = new QuestionBankMaterializationService(),
  ) {}

  async createDraft(userId: string, input: CreateMonitorInput) {
    console.log('Criacao de Monitor de IA iniciada', {
      event: 'monitor.create_started',
      userId,
      subjectCount: input.subjects.length,
      topicCount: input.subjects.reduce((total, subject) => total + subject.topics.length, 0),
      questionBankSelectionCount: input.questionBankSelections?.length ?? 0,
    });

    const result = await this.repository.createDraft(userId, input);
    if (result.kind !== 'CREATED') return result;

    console.log('Árvore do Monitor e seleções persistidas', {
      event: 'monitor.create_tree_persisted',
      userId,
      monitorId: result.monitor.id,
      status: result.monitor.status,
      subjects: result.monitor.subjects.map((subject) => ({
        id: subject.id,
        name: subject.name,
        topics: subject.topics.map((topic) => ({
          id: topic.id,
          name: topic.name,
          questionBankSelections: topic.questionBankSelections,
        })),
      })),
    });

    const persistedSelections = result.monitor.subjects.flatMap((subject) => subject.topics.flatMap((topic) => (
      topic.questionBankSelections.map((selection) => {
        const [topicName] = topic.name.split(' > ');
        return {
          monitorTopicId: topic.id,
          monitorSubjectId: subject.id,
          monitorSubtopicId: selection.monitorSubtopicId ?? null,
          monitorSubsubtopicId: selection.monitorSubsubtopicId ?? null,
          selection: normalizeQuestionBankSelection({
            subject: subject.name,
            topic: topicName ?? topic.name,
            examType: selection.examType,
            board: selection.board,
            subtopic: selection.subtopic,
            subsubtopic: selection.subsubtopic,
          }),
        };
      })
    )));

    if (persistedSelections.length === 0) {
      console.log('Monitor sem seleções do acervo; materialização não executada', {
        event: 'monitor.question_bank_materialization_skipped',
        monitorId: result.monitor.id,
        reason: 'NO_QUESTION_BANK_SELECTIONS',
      });
      return { ...result, materialization: null };
    }

    console.log('Iniciando materialização das seleções do acervo', {
      event: 'monitor.question_bank_materialization_started',
      monitorId: result.monitor.id,
      teacherId: result.monitor.teacher.id,
      selections: persistedSelections,
    });

    const materialization = await this.materializationService.materialize({
      teacherId: result.monitor.teacher.id,
      monitorId: result.monitor.id,
      selections: persistedSelections,
    });

    console.log('Materialização das seleções concluída', {
      event: 'monitor.question_bank_materialization_completed',
      monitorId: result.monitor.id,
      materialization,
    });

    return { ...result, materialization };
  }

  async findAllOwnedByUserId(userId: string) {
    return this.repository.findAllOwnedByUserId(userId);
  }

  async findOwnedByUserId(userId: string, monitorId: string) {
    return this.repository.findOwnedByUserId(userId, monitorId);
  }

  async addSubject(userId: string, monitorId: string, name: string, topics: string[] = []) {
    return this.repository.addSubject(userId, monitorId, name, topics);
  }

  async deleteSubject(userId: string, monitorId: string, subjectId: string) {
    return this.repository.deleteSubject(userId, monitorId, subjectId);
  }

  async addTopic(userId: string, monitorId: string, subjectId: string, name: string, definition?: string) {
    return this.repository.addTopic(userId, monitorId, subjectId, name, definition);
  }

  async deleteTopic(userId: string, monitorId: string, subjectId: string, topicId: string) {
    return this.repository.deleteTopic(userId, monitorId, subjectId, topicId);
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
    return this.repository.update(userId, monitorId, data);
  }

  setPublicationException(adminUserId: string, monitorId: string, allowed: boolean) {
    void adminUserId;
    return this.repository.setPublicationException(monitorId, allowed);
  }

  async getQuestionBankCatalog() {
    return this.repository.getQuestionBankCatalog();
  }
}
