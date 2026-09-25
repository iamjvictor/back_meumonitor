import type { FastifyInstance } from 'fastify';
import type { StudentAccessRepository } from '../student-access/student-access.service.js';
import { PrismaStudentAccessRepository } from '../student-access/student-access.repository.js';
import { createStudentAccessService } from '../student-access/student-access.service.js';
import { weeklySimulationQueue } from '../../queues/weekly-simulation.queue.js';
import { WeeklySimulationController } from './controllers/weekly-simulation.controller.js';
import { weeklySimulationRoutes } from './routes/weekly-simulation.routes.js';
import { WeeklySimulationRepository } from './repositories/weekly-simulation.repository.js';
import { WeeklySimulationAnswerService } from './services/weekly-simulation-answer.service.js';
import { WeeklySimulationGenerationService } from './services/weekly-simulation-generation.service.js';
import { WeeklySimulationSubmissionService } from './services/weekly-simulation-submission.service.js';

export async function registerWeeklySimulationModule(app: FastifyInstance, accessRepository?: StudentAccessRepository) {
  const access = createStudentAccessService(accessRepository ?? new PrismaStudentAccessRepository());
  const repository = new WeeklySimulationRepository();
  const generation = new WeeklySimulationGenerationService({ access, repository, publisher: { publish: async ({ simulationId }) => {
    const jobId = `weekly-simulation-${simulationId}`;
    console.info('[weekly-simulation]', { event: 'weekly_simulation.queue_publish_started', simulationId, jobId });
    try {
      const job = await weeklySimulationQueue.add('generate-weekly-simulation', { simulationId }, { jobId });
      console.info('[weekly-simulation]', { event: 'weekly_simulation.queue_publish_succeeded', simulationId, jobId: job.id, queue: 'monitor-weekly-simulations' });
    } catch (error) {
      console.error('[weekly-simulation]', { event: 'weekly_simulation.queue_publish_failed', simulationId, jobId, errorCode: error instanceof Error ? error.message : 'UNKNOWN_ERROR' });
      throw error;
    }
  } } });
  const answer = new WeeklySimulationAnswerService({ access, repository });
  const submission = new WeeklySimulationSubmissionService({ access, repository });
  await weeklySimulationRoutes(app, new WeeklySimulationController(generation, answer, repository, submission));
}
