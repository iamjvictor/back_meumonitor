import { getWeeklySimulationCycle, getWeeklySimulationState, type WeeklySimulationCycle, type WeeklySimulationState } from './weekly-simulation-cycle.service.js';

type SimulationReference = {
  id: string;
  status: Exclude<WeeklySimulationState, 'AVAILABLE_TO_GENERATE' | 'BLOCKED_BY_PREVIOUS'>;
  requestedAt?: Date;
  questionCount?: number;
  answeredCount?: number;
  correctCount?: number;
  scorePercent?: number | null;
  durationSeconds?: number | null;
  completedAt?: Date | null;
};

type GenerationRepository = {
  findByCycle(input: { studentId: string; monitorId: string; cycleStartDate: string }): Promise<SimulationReference | null>;
  findLatestIncompleteBeforeCycle(input: { studentId: string; monitorId: string; cycleStartDate: string }): Promise<SimulationReference | null>;
  createPending(input: { studentId: string; monitorId: string; cycleStartDate: string; generationJobId: string }): Promise<SimulationReference>;
  resetFailedToPending(input: { simulationId: string; generationJobId: string }): Promise<SimulationReference>;
};

type GenerationAccess = {
  assertMonitorAccess(input: { userId: string; monitorId: string }): Promise<{ studentId: string }>;
};

type GenerationPublisher = {
  publish(input: { simulationId: string }): Promise<void>;
};

export class WeeklySimulationGenerationService {
  private readonly cycleResolver: (now: Date) => WeeklySimulationCycle;

  constructor(private readonly input: {
    access: GenerationAccess;
    repository: GenerationRepository;
    publisher: GenerationPublisher;
    cycle?: (now: Date) => WeeklySimulationCycle;
  }) {
    this.cycleResolver = input.cycle ?? getWeeklySimulationCycle;
  }

  async requestGeneration(userId: string, monitorId: string, now = new Date()): Promise<{ simulationId: string; status: WeeklySimulationState }> {
    console.info('[weekly-simulation]', { event: 'weekly_simulation.generation_requested', userId, monitorId, requestedAt: now.toISOString() });
    const { studentId } = await this.input.access.assertMonitorAccess({ userId, monitorId });
    const cycle = this.cycleResolver(now);
    const current = await this.input.repository.findByCycle({ studentId, monitorId, cycleStartDate: cycle.cycleStartDate });
    if (current?.status === 'FAILED') {
      const generationJobId = `weekly-simulation:${studentId}:${monitorId}:${cycle.cycleStartDate}`;
      const simulation = await this.input.repository.resetFailedToPending({ simulationId: current.id, generationJobId });
      await this.input.publisher.publish({ simulationId: simulation.id });
      console.info('[weekly-simulation]', { event: 'weekly_simulation.retry_scheduled', simulationId: simulation.id, monitorId, cycleStartDate: cycle.cycleStartDate });
      return { simulationId: simulation.id, status: 'PENDING' };
    }
    if (current) {
      if (current.status === 'PENDING') {
        const generationJobId = `weekly-simulation:${studentId}:${monitorId}:${cycle.cycleStartDate}`;
        await this.input.publisher.publish({ simulationId: current.id });
        console.info('[weekly-simulation]', { event: 'weekly_simulation.pending_job_requeued', simulationId: current.id, monitorId, generationJobId });
      }
      console.info('[weekly-simulation]', { event: 'weekly_simulation.existing_cycle_reused', simulationId: current.id, monitorId, status: current.status });
      return { simulationId: current.id, status: current.status };
    }

    const previousIncomplete = await this.input.repository.findLatestIncompleteBeforeCycle({ studentId, monitorId, cycleStartDate: cycle.cycleStartDate });
    const state = getWeeklySimulationState({ current, previousIncomplete });
    if (state === 'BLOCKED_BY_PREVIOUS') { console.info('[weekly-simulation]', { event: 'weekly_simulation.blocked_by_previous', simulationId: previousIncomplete!.id, monitorId }); return { simulationId: previousIncomplete!.id, status: state }; }

    const generationJobId = `weekly-simulation:${studentId}:${monitorId}:${cycle.cycleStartDate}`;
    const simulation = await this.input.repository.createPending({ studentId, monitorId, cycleStartDate: cycle.cycleStartDate, generationJobId });
    console.info('[weekly-simulation]', { event: 'weekly_simulation.job_created', simulationId: simulation.id, monitorId, cycleStartDate: cycle.cycleStartDate, generationJobId });
    await this.input.publisher.publish({ simulationId: simulation.id });
    return { simulationId: simulation.id, status: 'PENDING' };
  }

  async getStatus(userId: string, monitorId: string, now = new Date()): Promise<{ simulationId: string | null; status: WeeklySimulationState; requestedAt?: Date; questionCount?: number; answeredCount?: number; correctCount?: number; scorePercent?: number | null; durationSeconds?: number | null; completedAt?: Date | null }> {
    const { studentId } = await this.input.access.assertMonitorAccess({ userId, monitorId });
    const cycle = this.cycleResolver(now);
    const current = await this.input.repository.findByCycle({ studentId, monitorId, cycleStartDate: cycle.cycleStartDate });
    const previousIncomplete = current ? null : await this.input.repository.findLatestIncompleteBeforeCycle({ studentId, monitorId, cycleStartDate: cycle.cycleStartDate });
    const status = getWeeklySimulationState({ current, previousIncomplete });
    const reference = current ?? previousIncomplete;
    return {
      simulationId: reference?.id ?? null,
      status,
      requestedAt: reference?.requestedAt,
      questionCount: reference?.questionCount,
      answeredCount: reference?.answeredCount,
      correctCount: reference?.correctCount,
      scorePercent: reference?.scorePercent,
      durationSeconds: reference?.durationSeconds,
      completedAt: reference?.completedAt,
    };
  }
}
