import type { CreateMonitorInput } from '../models/monitor.model.js';
import { MonitorRepository } from '../repositories/monitor.repository.js';

export class MonitorService {
  constructor(private readonly repository: MonitorRepository) {}

  async createDraft(userId: string, input: CreateMonitorInput) {
    console.log('Criacao de Monitor de IA iniciada', {
      event: 'monitor.create_started',
      userId,
      subjectCount: input.subjects.length,
      topicCount: input.subjects.reduce((total, subject) => total + subject.topics.length, 0),
    });

    return this.repository.createDraft(userId, input);
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
}
