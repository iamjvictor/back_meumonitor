type SubmissionAnswer = { itemId: string; selectedAnswer: string; responseTimeMs?: number };
type SubmissionRepository = {
  findSubmissionContext(simulationId: string, userId: string): Promise<{ studentId: string; monitorId: string; status: string; deadlineAt: Date | null } | null>;
  submitAnswers(input: { studentId: string; simulationId: string; answers: SubmissionAnswer[] }): Promise<{ completed: boolean; durationSeconds: number | null }>;
};
type SubmissionAccess = { assertMonitorAccess(input: { userId: string; monitorId: string }): Promise<{ studentId: string }> };

export class WeeklySimulationSubmissionService {
  constructor(private readonly input: { access: SubmissionAccess; repository: SubmissionRepository }) {}

  async submit(userId: string, simulationId: string, answers: SubmissionAnswer[]) {
    if (answers.length === 0) throw new Error('SIMULATION_ANSWERS_REQUIRED');
    for (const answer of answers) {
      if (!answer.itemId || !answer.selectedAnswer.trim()) throw new Error('INVALID_SIMULATION_ANSWER');
      if (answer.responseTimeMs !== undefined && (answer.responseTimeMs < 0 || answer.responseTimeMs > 86_400_000)) throw new Error('INVALID_RESPONSE_TIME');
    }
    const context = await this.input.repository.findSubmissionContext(simulationId, userId);
    if (!context) throw new Error('SIMULATION_NOT_FOUND');
    const access = await this.input.access.assertMonitorAccess({ userId, monitorId: context.monitorId });
    if (access.studentId !== context.studentId) throw new Error('SIMULATION_NOT_FOUND');
    if (context.status !== 'IN_PROGRESS') throw new Error('SIMULATION_NOT_ANSWERABLE');
    if (context.deadlineAt && context.deadlineAt.getTime() <= Date.now()) throw new Error('SIMULATION_TIME_EXPIRED');
    const result = await this.input.repository.submitAnswers({ studentId: context.studentId, simulationId, answers });
    console.info('[weekly-simulation]', { event: 'weekly_simulation.submitted', userId, simulationId, answerCount: answers.length, durationSeconds: result.durationSeconds });
    return result;
  }
}
