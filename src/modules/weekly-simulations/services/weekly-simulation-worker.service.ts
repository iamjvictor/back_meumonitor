import { WeeklySimulationRepository } from '../repositories/weekly-simulation.repository.js';
import { StudentPerformanceRepository } from '../../student-performance/repositories/student-performance.repository.js';
import { WeeklySimulationDiagnosticService } from './weekly-simulation-diagnostic.service.js';
import { distributeWeeklySimulationQuestions } from './weekly-simulation-distribution.service.js';

export class WeeklySimulationWorkerService {
  constructor(
    private readonly repository = new WeeklySimulationRepository(),
    private readonly diagnostic = new WeeklySimulationDiagnosticService(new StudentPerformanceRepository()),
  ) {}

  async process(simulationId: string) {
    const startedAt = Date.now();
    console.info('[weekly-simulation]', { event: 'weekly_simulation.worker_started', simulationId });
    await this.repository.markProcessing(simulationId);
    try {
      const context = await this.repository.getGenerationContext(simulationId);
      console.info('[weekly-simulation]', { event: 'weekly_simulation.context_loaded', simulationId, studentId: context.studentId, monitorId: context.monitorId, cycleStartDate: context.cycleStartDate.toISOString() });
      const { pools, history } = await this.repository.findApprovedQuestionPools(context.studentId, context.monitorId);
      console.info('[weekly-simulation]', { event: 'weekly_simulation.question_pools_loaded', simulationId, poolCount: pools.length, availableQuestionCount: pools.reduce((total, pool) => total + pool.questions.length, 0), historyCount: history.size });
      if (pools.length === 0) throw new Error('NO_APPROVED_QUESTIONS');
      const startDate = context.cycleStartDate.toISOString().slice(0, 10);
      const diagnostic = await this.diagnostic.collect({
        studentId: context.studentId,
        monitorId: context.monitorId,
        window: { from: new Date(`${startDate}T23:59:00.000-03:00`), to: new Date() },
        availableTopics: pools.map((pool) => ({ monitorId: pool.monitorId, subjectId: pool.subjectId, topicId: pool.topicId, topicName: null })),
      });
      const enrichedPools = pools.map((pool) => ({
        ...pool,
        difficultyScore: diagnostic.find((item) => item.subjectId === pool.subjectId && item.topicId === pool.topicId)?.difficultyScore ?? 0.5,
      }));
      console.info('[weekly-simulation]', { event: 'weekly_simulation.pools_enriched', simulationId, poolsJson: JSON.stringify(enrichedPools.map((pool) => ({ subjectId: pool.subjectId, topicId: pool.topicId, difficultyScore: pool.difficultyScore, questionCount: pool.questions.length }))) });
      const selected = distributeWeeklySimulationQuestions({ topics: enrichedPools, targetCount: 30, history });
      console.info('[weekly-simulation]', { event: 'weekly_simulation.question_distribution_calculated', simulationId, targetCount: 30, selectedQuestionCount: selected.length });
      selected.forEach((item, index) => console.info('[weekly-simulation]', { event: 'weekly_simulation.questions_selected', simulationId, position: index + 1, questionId: item.id, subjectId: item.subjectId, topicId: item.topicId, difficultyScore: item.difficultyScore, selectionPriority: item.selectionPriority, selectionReason: item.selectionReason }));
      const snapshot = { version: 1, cycleStartDate: startDate, analysisStartedAt: new Date(`${startDate}T23:59:00.000-03:00`).toISOString(), analysisEndedAt: new Date().toISOString(), timezone: 'America/Sao_Paulo', diagnostic, selectedQuestionCount: selected.length };
      await this.repository.saveGenerated({ simulationId, items: selected.map((item, index) => ({ questionId: item.id, position: index + 1, subjectId: item.subjectId, topicId: item.topicId, difficultyScore: item.difficultyScore, selectionPriority: item.selectionPriority, selectionReason: item.selectionReason })), snapshot });
      console.info('[weekly-simulation]', { event: 'weekly_simulation.persisted', simulationId, questionCount: selected.length, durationMs: Date.now() - startedAt });
      return { simulationId, questionCount: selected.length };
    } catch (error) {
      console.error('[weekly-simulation]', { event: 'weekly_simulation.failed', simulationId, durationMs: Date.now() - startedAt, errorCode: error instanceof Error ? error.message : 'UNKNOWN_ERROR' });
      await this.repository.markFailed(simulationId, error);
      throw error;
    }
  }
}
