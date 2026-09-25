type AnswerItem = {
  id: string;
  simulationId: string;
  monitorId: string;
  correctAnswer: string | null;
  answered: boolean;
  simulationStatus?: 'PENDING' | 'PROCESSING' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  deadlineAt?: Date | null;
  existing?: { isCorrect: boolean };
};

type AnswerRepository = {
  findSimulationMonitor(simulationId: string): Promise<{ monitorId: string } | null>;
  findItemForAnswer(input: { simulationId: string; itemId: string; studentId: string }): Promise<AnswerItem | null>;
  saveAnswer(input: {
    studentId: string;
    simulationId: string;
    itemId: string;
    selectedAnswer: string;
    isCorrect: boolean;
    responseTimeMs?: number;
  }): Promise<{ isCorrect: boolean; durationSeconds: number | null }>;
};

type AnswerAccess = {
  assertMonitorAccess(input: { userId: string; monitorId: string }): Promise<{ studentId: string }>;
};

export class WeeklySimulationAnswerService {
  constructor(private readonly input: { access: AnswerAccess; repository: AnswerRepository }) {}

  async answer(userId: string, simulationId: string, itemId: string, data: { selectedAnswer: string; responseTimeMs?: number }) {
    const selectedAnswer = data.selectedAnswer.trim();
    if (!selectedAnswer) throw new Error('INVALID_SELECTED_ANSWER');
    if (data.responseTimeMs !== undefined && (data.responseTimeMs < 0 || data.responseTimeMs > 86_400_000)) throw new Error('INVALID_RESPONSE_TIME');

    const simulation = await this.input.repository.findSimulationMonitor(simulationId);
    if (!simulation) throw new Error('SIMULATION_NOT_FOUND');
    const { studentId } = await this.input.access.assertMonitorAccess({ userId, monitorId: simulation.monitorId });
    const item = await this.input.repository.findItemForAnswer({ simulationId, itemId, studentId });
    if (!item) throw new Error('SIMULATION_ITEM_NOT_FOUND');
    if (item.simulationStatus !== undefined && !['IN_PROGRESS'].includes(item.simulationStatus)) throw new Error('SIMULATION_NOT_ANSWERABLE');
    if (item.deadlineAt && item.deadlineAt.getTime() <= Date.now()) throw new Error('SIMULATION_TIME_EXPIRED');
    if (item.answered && item.existing) return { alreadyAnswered: true, isCorrect: item.existing.isCorrect, durationSeconds: null };

    const normalizedCorrect = item.correctAnswer?.trim().toUpperCase();
    const isCorrect = Boolean(normalizedCorrect && selectedAnswer.toUpperCase() === normalizedCorrect);
    const saved = await this.input.repository.saveAnswer({ studentId, simulationId, itemId, selectedAnswer, isCorrect, responseTimeMs: data.responseTimeMs });
    console.info('[weekly-simulation]', { event: 'weekly_simulation.answer_recorded', simulationId, itemId, studentId, isCorrect: saved.isCorrect, alreadyAnswered: false, durationSeconds: saved.durationSeconds });
    return { alreadyAnswered: false, isCorrect: saved.isCorrect, durationSeconds: saved.durationSeconds };
  }
}
