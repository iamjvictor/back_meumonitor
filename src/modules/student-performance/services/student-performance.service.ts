import { StudentQuestionAttemptRepository } from '../../student-question-attempts/repositories/student-question-attempt.repository.js';
import { StudentPerformanceRepository, type StudentPerformanceRow } from '../repositories/student-performance.repository.js';

export type { StudentPerformanceRow } from '../repositories/student-performance.repository.js';

type PerformanceTopic = {
  id: string | null;
  name: string;
  answeredCount: number;
  correctCount: number;
  incorrectCount: number;
  accuracy: number;
  lastAnsweredAt: string | null;
};

type PerformanceSubject = {
  id: string;
  name: string;
  answeredCount: number;
  correctCount: number;
  incorrectCount: number;
  accuracy: number;
  topics: PerformanceTopic[];
};

type PerformanceMonitor = {
  id: string;
  name: string;
  answeredCount: number;
  correctCount: number;
  incorrectCount: number;
  accuracy: number;
  subjects: PerformanceSubject[];
};

function accuracy(correctCount: number, answeredCount: number) {
  return answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0;
}

function increment(target: { answeredCount: number; correctCount: number }, row: StudentPerformanceRow) {
  target.answeredCount += row.answeredCount;
  target.correctCount += row.correctCount;
}

export function buildPerformanceResponse(rows: StudentPerformanceRow[]) {
  const summaryBase = { answeredCount: 0, correctCount: 0 };
  const monitors = new Map<string, PerformanceMonitor>();
  const weakTopics = new Map<string, PerformanceTopic>();

  for (const row of rows) {
    increment(summaryBase, row);
    let monitor = monitors.get(row.monitorId);
    if (!monitor) {
      monitor = { id: row.monitorId, name: row.monitorName, answeredCount: 0, correctCount: 0, incorrectCount: 0, accuracy: 0, subjects: [] };
      monitors.set(row.monitorId, monitor);
    }
    increment(monitor, row);

    let subject = monitor.subjects.find((item) => item.id === row.subjectId);
    if (!subject) {
      subject = { id: row.subjectId, name: row.subjectName, answeredCount: 0, correctCount: 0, incorrectCount: 0, accuracy: 0, topics: [] };
      monitor.subjects.push(subject);
    }
    increment(subject, row);

    const topicKey = `${row.monitorId}:${row.subjectId}:${row.topicId ?? 'none'}`;
    let topic = weakTopics.get(topicKey);
    if (!topic) {
      topic = { id: row.topicId, name: row.topicName ?? 'Sem tópico', answeredCount: 0, correctCount: 0, incorrectCount: 0, accuracy: 0, lastAnsweredAt: row.lastAnsweredAt };
      weakTopics.set(topicKey, topic);
      subject.topics.push(topic);
    }
    increment(topic, row);
    topic.lastAnsweredAt = topic.lastAnsweredAt && row.lastAnsweredAt && topic.lastAnsweredAt > row.lastAnsweredAt ? topic.lastAnsweredAt : row.lastAnsweredAt;
  }

  const finalize = (item: { answeredCount: number; correctCount: number; incorrectCount: number; accuracy: number }) => {
    item.incorrectCount = item.answeredCount - item.correctCount;
    item.accuracy = accuracy(item.correctCount, item.answeredCount);
  };

  const monitorList = Array.from(monitors.values()).map((monitor) => {
    finalize(monitor);
    monitor.subjects.forEach((subject) => {
      finalize(subject);
      subject.topics.forEach((topic) => finalize(topic));
      subject.topics.sort((left, right) => left.accuracy - right.accuracy || right.answeredCount - left.answeredCount);
    });
    monitor.subjects.sort((left, right) => left.accuracy - right.accuracy || right.answeredCount - left.answeredCount);
    return monitor;
  });

  const summary = {
    ...summaryBase,
    incorrectCount: summaryBase.answeredCount - summaryBase.correctCount,
    accuracy: accuracy(summaryBase.correctCount, summaryBase.answeredCount),
  };

  return {
    summary,
    monitors: monitorList,
    weakTopics: Array.from(weakTopics.values())
      .map((topic) => { finalize(topic); return topic; })
      .sort((left, right) => left.accuracy - right.accuracy || right.answeredCount - left.answeredCount)
      .slice(0, 8),
  };
}

export class StudentPerformanceService {
  constructor(
    private readonly repository = new StudentPerformanceRepository(),
    private readonly accessRepository = new StudentQuestionAttemptRepository(),
  ) {}

  async getForUser(userId: string) {
    const student = await this.repository.findStudentByUserId(userId);
    if (!student) throw new Error('STUDENT_NOT_FOUND');
    const monitorIds = await this.accessRepository.findAccessibleMonitorIds(student.id, userId);
    const rows = await this.repository.aggregateByScope(student.id, monitorIds);
    return buildPerformanceResponse(rows);
  }
}
