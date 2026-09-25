import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.middleware.js';
import type { WeeklySimulationController } from '../controllers/weekly-simulation.controller.js';

export async function weeklySimulationRoutes(app: FastifyInstance, controller: WeeklySimulationController) {
  const auth = { onRequest: authMiddleware };
  app.get<{ Params: { monitorId: string } }>('/monitors/:monitorId/weekly-simulation', auth, controller.status.bind(controller));
  app.post<{ Params: { monitorId: string } }>('/monitors/:monitorId/weekly-simulation/generate', auth, controller.generate.bind(controller));
  app.get<{ Params: { simulationId: string } }>('/weekly-simulations/:simulationId', auth, controller.get.bind(controller));
  app.post<{ Params: { simulationId: string } }>('/weekly-simulations/:simulationId/start', auth, controller.start.bind(controller));
  app.get<{ Params: { simulationId: string } }>('/weekly-simulations/:simulationId/result', auth, controller.get.bind(controller));
  app.post<{ Params: { simulationId: string }; Body: unknown }>('/weekly-simulations/:simulationId/submit', auth, controller.submit.bind(controller));
}
