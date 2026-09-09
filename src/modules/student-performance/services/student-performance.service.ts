import { StudentQuestionAttemptRepository } from '../../student-question-attempts/repositories/student-question-attempt.repository.js';
import { StudentPerformanceRepository, type StudentPerformanceRow, type StudentFlashcardPerformanceRow } from '../repositories/student-performance.repository.js';

export type { StudentPerformanceRow, StudentFlashcardPerformanceRow } from '../repositories/student-performance.repository.js';

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

export type FlashcardTopic = {
  id: string | null;
  name: string;
  reviewedCount: number;
  retainedCount: number;
  retentionRate: number;
  againCount: number;
  hardCount: number;
  goodCount: number;
  easyCount: number;
};

export type FlashcardSubject = {
  id: string;
  name: string;
  reviewedCount: number;
  retainedCount: number;
  retentionRate: number;
  againCount: number;
  hardCount: number;
  goodCount: number;
  easyCount: number;
  topics: FlashcardTopic[];
};

export type FlashcardMonitor = {
  id: string;
  name: string;
  reviewedCount: number;
  retainedCount: number;
  retentionRate: number;
  againCount: number;
  hardCount: number;
  goodCount: number;
  easyCount: number;
  subjects: FlashcardSubject[];
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

export function buildFlashcardsPerformanceResponse(
  rows: StudentFlashcardPerformanceRow[],
  overview: { dueCount: number; totalCardsCount: number }
) {
  const summaryBase = {
    reviewedCount: 0,
    retainedCount: 0,
    againCount: 0,
    hardCount: 0,
    goodCount: 0,
    easyCount: 0,
  };
  const monitors = new Map<string, FlashcardMonitor>();
  const weakFlashcardTopics = new Map<string, FlashcardTopic>();

  for (const row of rows) {
    summaryBase.reviewedCount += row.reviewedCount;
    summaryBase.retainedCount += row.retainedCount;
    summaryBase.againCount += row.againCount;
    summaryBase.hardCount += row.hardCount;
    summaryBase.goodCount += row.goodCount;
    summaryBase.easyCount += row.easyCount;

    let monitor = monitors.get(row.monitorId);
    if (!monitor) {
      monitor = {
        id: row.monitorId,
        name: row.monitorName,
        reviewedCount: 0,
        retainedCount: 0,
        retentionRate: 0,
        againCount: 0,
        hardCount: 0,
        goodCount: 0,
        easyCount: 0,
        subjects: [],
      };
      monitors.set(row.monitorId, monitor);
    }
    monitor.reviewedCount += row.reviewedCount;
    monitor.retainedCount += row.retainedCount;
    monitor.againCount += row.againCount;
    monitor.hardCount += row.hardCount;
    monitor.goodCount += row.goodCount;
    monitor.easyCount += row.easyCount;

    let subject = monitor.subjects.find((s) => s.id === row.subjectId);
    if (!subject) {
      subject = {
        id: row.subjectId,
        name: row.subjectName,
        reviewedCount: 0,
        retainedCount: 0,
        retentionRate: 0,
        againCount: 0,
        hardCount: 0,
        goodCount: 0,
        easyCount: 0,
        topics: [],
      };
      monitor.subjects.push(subject);
    }
    subject.reviewedCount += row.reviewedCount;
    subject.retainedCount += row.retainedCount;
    subject.againCount += row.againCount;
    subject.hardCount += row.hardCount;
    subject.goodCount += row.goodCount;
    subject.easyCount += row.easyCount;

    const topicKey = `${row.monitorId}:${row.subjectId}:${row.topicId ?? 'none'}`;
    let topic = weakFlashcardTopics.get(topicKey);
    if (!topic) {
      topic = {
        id: row.topicId,
        name: row.topicName ?? 'Sem tópico',
        reviewedCount: 0,
        retainedCount: 0,
        retentionRate: 0,
        againCount: 0,
        hardCount: 0,
        goodCount: 0,
        easyCount: 0,
      };
      weakFlashcardTopics.set(topicKey, topic);
      subject.topics.push(topic);
    }
    topic.reviewedCount += row.reviewedCount;
    topic.retainedCount += row.retainedCount;
    topic.againCount += row.againCount;
    topic.hardCount += row.hardCount;
    topic.goodCount += row.goodCount;
    topic.easyCount += row.easyCount;
  }

  const finalizeFlashcardItem = (item: { reviewedCount: number; retainedCount: number; retentionRate: number }) => {
    item.retentionRate = accuracy(item.retainedCount, item.reviewedCount);
  };

  const monitorList = Array.from(monitors.values()).map((monitor) => {
    finalizeFlashcardItem(monitor);
    monitor.subjects.forEach((subject) => {
      finalizeFlashcardItem(subject);
      subject.topics.forEach((topic) => finalizeFlashcardItem(topic));
      subject.topics.sort((a, b) => a.retentionRate - b.retentionRate || b.reviewedCount - a.reviewedCount);
    });
    monitor.subjects.sort((a, b) => a.retentionRate - b.retentionRate || b.reviewedCount - a.reviewedCount);
    return monitor;
  });

  const summary = {
    ...summaryBase,
    retentionRate: accuracy(summaryBase.retainedCount, summaryBase.reviewedCount),
    dueCount: overview.dueCount,
    totalCardsCount: overview.totalCardsCount,
  };

  return {
    summary,
    monitors: monitorList,
    weakTopics: Array.from(weakFlashcardTopics.values())
      .map((t) => { finalizeFlashcardItem(t); return t; })
      .sort((a, b) => a.retentionRate - b.retentionRate || b.reviewedCount - a.reviewedCount)
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

    const [rows, flashcardRows, flashcardOverview] = await Promise.all([
      this.repository.aggregateByScope(student.id, monitorIds),
      this.repository.aggregateFlashcardByScope(student.id, monitorIds),
      this.repository.getFlashcardOverview(student.id, monitorIds),
    ]);

    const questionsPerformance = buildPerformanceResponse(rows);
    const flashcardsPerformance = buildFlashcardsPerformanceResponse(flashcardRows, flashcardOverview);

    return {
      ...questionsPerformance,
      flashcards: flashcardsPerformance,
    };
  }
}

