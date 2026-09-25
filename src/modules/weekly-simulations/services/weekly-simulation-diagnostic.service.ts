import type {
  PerformanceWindow,
  StudentFlashcardPerformanceRow,
  StudentPerformanceRow,
} from '../../student-performance/repositories/student-performance.repository.js';

export type WeeklyQuestionDiagnosticRow = {
  monitorId: string;
  subjectId: string;
  topicId: string | null;
  topicName: string | null;
  answeredCount: number;
  correctCount: number;
};

export type WeeklyFlashcardDiagnosticRow = {
  monitorId: string;
  subjectId: string;
  topicId: string | null;
  topicName: string | null;
  reviewedCount: number;
  againCount: number;
  hardCount: number;
  goodCount: number;
  easyCount: number;
};

export type WeeklyAvailableTopic = {
  monitorId: string;
  subjectId: string;
  topicId: string | null;
  topicName: string | null;
};

export type WeeklyTopicDiagnostic = WeeklyAvailableTopic & {
  questionEvidenceCount: number;
  questionIncorrectCount: number;
  flashcardEvidenceCount: number;
  questionDifficulty: number;
  flashcardDifficulty: number;
  difficultyScore: number;
};

type TopicAccumulator = WeeklyAvailableTopic & {
  questionEvidenceCount: number;
  questionCorrectCount: number;
  flashcardEvidenceCount: number;
  againCount: number;
  hardCount: number;
  goodCount: number;
  easyCount: number;
};

const QUESTION_WEIGHT = 0.6;
const FLASHCARD_WEIGHT = 0.4;
const SMOOTHING_PRIOR_COUNT = 4;
const FLASHCARD_DIFFICULTY: Record<'againCount' | 'hardCount' | 'goodCount' | 'easyCount', number> = {
  againCount: 1,
  hardCount: 0.6,
  goodCount: 0.2,
  easyCount: 0,
};

function topicKey(row: WeeklyAvailableTopic): string {
  return `${row.monitorId}:${row.subjectId}:${row.topicId ?? 'none'}`;
}

function smoothed(value: number, evidenceCount: number): number {
  if (evidenceCount === 0) return 0.5;
  const confidence = evidenceCount / (evidenceCount + SMOOTHING_PRIOR_COUNT);
  return 0.5 + (value - 0.5) * confidence;
}

function addTopic(map: Map<string, TopicAccumulator>, topic: WeeklyAvailableTopic): TopicAccumulator {
  const key = topicKey(topic);
  const current = map.get(key);
  if (current) return current;
  const created: TopicAccumulator = {
    ...topic,
    topicName: topic.topicName ?? 'Sem tópico',
    questionEvidenceCount: 0,
    questionCorrectCount: 0,
    flashcardEvidenceCount: 0,
    againCount: 0,
    hardCount: 0,
    goodCount: 0,
    easyCount: 0,
  };
  map.set(key, created);
  return created;
}

export function buildWeeklySimulationDiagnostic(input: {
  questions: WeeklyQuestionDiagnosticRow[];
  flashcards: WeeklyFlashcardDiagnosticRow[];
  availableTopics?: WeeklyAvailableTopic[];
}): WeeklyTopicDiagnostic[] {
  const topics = new Map<string, TopicAccumulator>();
  input.availableTopics?.forEach((topic) => addTopic(topics, topic));

  input.questions.forEach((row) => {
    const topic = addTopic(topics, row);
    topic.questionEvidenceCount += row.answeredCount;
    topic.questionCorrectCount += row.correctCount;
  });

  input.flashcards.forEach((row) => {
    const topic = addTopic(topics, row);
    topic.flashcardEvidenceCount += row.reviewedCount;
    topic.againCount += row.againCount;
    topic.hardCount += row.hardCount;
    topic.goodCount += row.goodCount;
    topic.easyCount += row.easyCount;
  });

  return Array.from(topics.values()).map((topic) => {
    const questionRaw = topic.questionEvidenceCount > 0
      ? (topic.questionEvidenceCount - topic.questionCorrectCount) / topic.questionEvidenceCount
      : 0.5;
    const flashcardRaw = topic.flashcardEvidenceCount > 0
      ? (
        topic.againCount * FLASHCARD_DIFFICULTY.againCount
        + topic.hardCount * FLASHCARD_DIFFICULTY.hardCount
        + topic.goodCount * FLASHCARD_DIFFICULTY.goodCount
        + topic.easyCount * FLASHCARD_DIFFICULTY.easyCount
      ) / topic.flashcardEvidenceCount
      : 0.5;
    const questionDifficulty = smoothed(questionRaw, topic.questionEvidenceCount);
    const flashcardDifficulty = smoothed(flashcardRaw, topic.flashcardEvidenceCount);
    const hasQuestions = topic.questionEvidenceCount > 0;
    const hasFlashcards = topic.flashcardEvidenceCount > 0;
    const difficultyScore = hasQuestions && hasFlashcards
      ? QUESTION_WEIGHT * questionDifficulty + FLASHCARD_WEIGHT * flashcardDifficulty
      : hasQuestions ? questionDifficulty : hasFlashcards ? flashcardDifficulty : 0.5;

    return {
      monitorId: topic.monitorId,
      subjectId: topic.subjectId,
      topicId: topic.topicId,
      topicName: topic.topicName,
      questionEvidenceCount: topic.questionEvidenceCount,
      questionIncorrectCount: topic.questionEvidenceCount - topic.questionCorrectCount,
      flashcardEvidenceCount: topic.flashcardEvidenceCount,
      questionDifficulty,
      flashcardDifficulty,
      difficultyScore,
    };
  }).sort((left, right) => right.difficultyScore - left.difficultyScore);
}

export const WEEKLY_SIMULATION_DIAGNOSTIC_CONFIG = {
  questionWeight: QUESTION_WEIGHT,
  flashcardWeight: FLASHCARD_WEIGHT,
  smoothingPriorCount: SMOOTHING_PRIOR_COUNT,
  flashcardDifficultyWeights: { ...FLASHCARD_DIFFICULTY },
} as const;

type WeeklyDiagnosticRepository = {
  aggregateByScope(
    studentId: string,
    monitorIds: string[],
    mode: 'PRACTICE' | 'SIMULATED' | 'DAILY_CHALLENGE',
    window?: PerformanceWindow,
  ): Promise<StudentPerformanceRow[]>;
  aggregateFlashcardByScope(
    studentId: string,
    monitorIds: string[],
    window?: PerformanceWindow,
  ): Promise<StudentFlashcardPerformanceRow[]>;
};

export class WeeklySimulationDiagnosticService {
  constructor(private readonly repository: WeeklyDiagnosticRepository) {}

  async collect(input: {
    studentId: string;
    monitorId: string;
    window: PerformanceWindow;
    availableTopics?: WeeklyAvailableTopic[];
  }): Promise<WeeklyTopicDiagnostic[]> {
    const [practice, simulated, dailyChallenge, flashcards] = await Promise.all([
      this.repository.aggregateByScope(input.studentId, [input.monitorId], 'PRACTICE', input.window),
      this.repository.aggregateByScope(input.studentId, [input.monitorId], 'SIMULATED', input.window),
      this.repository.aggregateByScope(input.studentId, [input.monitorId], 'DAILY_CHALLENGE', input.window),
      this.repository.aggregateFlashcardByScope(input.studentId, [input.monitorId], input.window),
    ]);

    const performanceDataJson = JSON.stringify({ practice, simulated, dailyChallenge, flashcards });
    console.info('[weekly-simulation]', { event: 'weekly_simulation.performance_data_loaded', studentId: input.studentId, monitorId: input.monitorId, window: input.window, performanceDataJson });

    const diagnostic = buildWeeklySimulationDiagnostic({
      questions: [...practice, ...simulated, ...dailyChallenge],
      flashcards,
      availableTopics: input.availableTopics,
    });
    console.info('[weekly-simulation]', { event: 'weekly_simulation.diagnostic_calculated', studentId: input.studentId, monitorId: input.monitorId, diagnosticJson: JSON.stringify(diagnostic) });
    return diagnostic;
  }
}
