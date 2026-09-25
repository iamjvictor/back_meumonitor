import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.middleware.js';
import type { DailyChallengeController } from '../controllers/daily-challenge.controller.js';

export async function dailyChallengeRoutes(app: FastifyInstance, controller: DailyChallengeController) {
  const auth = { onRequest: authMiddleware };
  app.get('/daily-challenges', auth, controller.currentForStudent.bind(controller));
  app.get('/daily-challenges/summary', auth, controller.dashboardSummary.bind(controller));
  app.get<{ Params: { monitorId: string } }>('/monitors/:monitorId/daily-challenge', auth, controller.current.bind(controller));
  app.get<{ Params: { monitorId: string }; Querystring: { month?: string } }>('/monitors/:monitorId/daily-challenge/ranking', auth, controller.ranking.bind(controller));
  app.post<{ Params: { challengeId: string }; Body: unknown }>('/daily-challenges/:challengeId/answer', auth, controller.answer.bind(controller));
}
