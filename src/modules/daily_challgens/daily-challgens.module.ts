import { DailyChallengeController } from './controllers/daily-challenge.controller.js';
import { dailyChallengeRoutes } from './routes/daily-challenge.routes.js';
import type { FastifyInstance } from 'fastify';

export async function registerDailyChallgensModule(app: FastifyInstance) {
  await dailyChallengeRoutes(app, new DailyChallengeController());
}
