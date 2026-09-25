import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../middleware/auth.middleware.js';
import type { PaymentsController } from './payments.controller.js';
import type { PaymentSubscriptionController } from './payment-subscription.controller.js';
import type { TeacherPayoutController } from './teacher-payout.controller.js';

export async function paymentsRoutes(app: FastifyInstance, controller: PaymentsController, subscriptionController?: PaymentSubscriptionController, teacherPayoutController?: TeacherPayoutController) {
  app.post('/payments/checkout', { onRequest: authMiddleware }, controller.create.bind(controller));
  if (subscriptionController) {
    app.get('/student/subscriptions', { onRequest: authMiddleware }, subscriptionController.list.bind(subscriptionController));
    app.get('/student/subscriptions/:subscriptionId', { onRequest: authMiddleware }, subscriptionController.detail.bind(subscriptionController));
    app.get('/student/subscriptions/history', { onRequest: authMiddleware }, subscriptionController.history.bind(subscriptionController));
    app.delete('/student/subscriptions/:subscriptionId/items/:monitorId', { onRequest: authMiddleware }, subscriptionController.remove.bind(subscriptionController));
  }
  if (teacherPayoutController) {
    app.get('/teachers/me/students/subscriptions', { onRequest: authMiddleware }, teacherPayoutController.list.bind(teacherPayoutController));
    app.get('/teachers/me/payouts/summary', { onRequest: authMiddleware }, teacherPayoutController.summary.bind(teacherPayoutController));
  }
}
