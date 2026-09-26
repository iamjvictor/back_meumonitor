import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { corsAllowedHeaders, env, isCorsOriginAllowed } from './config/env.js';
import { authRoutes } from './routes/auth.routes.js';
import { protectedRoutes } from './routes/protected.routes.js';
import { teacherRoutes } from './routes/teacher.routes.js';
import { profileImageRoutes } from './routes/profile-image.routes.js';
import { monitorRoutes } from './routes/monitor.routes.js';
import { documentRoutes } from './routes/document.routes.js';
import { contentReviewRoutes } from './routes/content-review.routes.js';
import { questionRoutes } from './routes/question.routes.js';
import { studentPurchaseRoutes } from './routes/student-purchase.routes.js';
import { registerDailyChallgensModule } from './modules/daily_challgens/daily-challgens.module.js';
import { studentQuestionAttemptRoutes } from './modules/student-question-attempts/routes/student-question-attempt.routes.js';
import { teacherPracticePreviewRoutes } from './modules/teacher-practice-preview/routes/teacher-practice-preview.routes.js';
import { studentConsistencyRoutes } from './modules/student-consistency/routes/student-consistency.routes.js';
import { studentPerformanceRoutes } from './modules/student-performance/routes/student-performance.routes.js';
import { studentExperienceRoutes } from './modules/student-experience/routes/student-experience.routes.js';
import { chatRoutes } from './modules/chat/chat.routes.js';
import { studentContentReportRoutes } from './modules/student-content-report/routes/student-content-report.routes.js';
import { createStudentProfileModule } from './modules/student-profile/student-profile.module.js';
import { studentProfileRoutes } from './modules/student-profile/student-profile.routes.js';
import { createStudentAccessModule } from './modules/student-access/student-access.module.js';
import { studentAccessRoutes } from './modules/student-access/student-access.routes.js';
import { createStudentFlashcardsModule } from './modules/student-flashcards/student-flashcards.module.js';
import { studentFlashcardsRoutes } from './modules/student-flashcards/student-flashcards.routes.js';
import { registerWeeklySimulationModule } from './modules/weekly-simulations/weekly-simulations.module.js';
import { createErrorHandler } from './core/errors/error-handler.js';
import { createPaymentsWebhookModule } from './modules/payments/payments-webhook.module.js';
import { asaasWebhookRoutes } from './modules/payments/http/asaas-webhook.routes.js';
import { createPaymentAccountModule } from './modules/payments/payments-account.module.js';
import { paymentAccountRoutes } from './modules/payments/http/payment-account.routes.js';
import { paymentAccountCredentialRoutes } from './modules/payments/http/payment-account-credential.routes.js';
import { createPaymentsModule } from './modules/payments/payments.module.js';
import { paymentsRoutes } from './modules/payments/http/payments.routes.js';
import { getAsaasBaseUrl, selectAsaasApiKey } from './modules/payments/infrastructure/providers/asaas/asaas.config.js';
import { getWorkerHealth } from './health/worker-health.js';
import { Redis } from 'ioredis';
import { EntitlementService } from './modules/access/application/entitlement.service.js';
import { PaymentEntitlementRepository } from './modules/access/infrastructure/payment-entitlement.repository.js';
import { RedisEntitlementCache } from './modules/access/infrastructure/redis-entitlement-cache.js';
import { EntitlementController } from './modules/access/http/entitlement.controller.js';
import { entitlementRoutes } from './modules/access/http/entitlement.routes.js';

// Railway terminates HTTPS at the public edge; the Node process listens on HTTP internally.
const app = Fastify({
  trustProxy: true,
  logger: false,
  bodyLimit: 10 * 1024 * 1024, // 10MB limit for uploading base64 avatars
});

app.addHook('onRequest', async (request) => {
  console.log('Requisicao HTTP recebida', {
    event: 'http.request_received',
    requestId: request.id,
    method: request.method,
    url: request.url,
    origin: request.headers.origin,
    accessControlRequestMethod: request.headers['access-control-request-method'],
    hasAuthorization: Boolean(request.headers.authorization),
    hasCookies: Boolean(request.headers.cookie),
  });
});

await app.register(helmet);
await app.register(cookie);
await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024, files: 1 } });
await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (isCorsOriginAllowed(origin)) {
      return cb(null, true);
    }
    return cb(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: corsAllowedHeaders,
});
await app.register(rateLimit, { max: env.LOAD_TEST_RATE_LIMIT_MAX, timeWindow: '1 minute' });

app.get('/health', async () => ({ status: 'ok' }));
app.get('/health/worker', async (_request, reply) => {
  try {
    const workerHealth = await getWorkerHealth(entitlementRedis);
    if (!workerHealth.ready) {
      return reply.code(503).send({ status: 'unavailable', worker: 'not_ready' });
    }
    return { status: 'ok', worker: 'ready' };
  } catch (error) {
    console.warn('Falha ao consultar saúde do worker', {
      event: 'monitor.worker_health_check_failed',
      error: error instanceof Error ? error.message : String(error),
    });
    return reply.code(503).send({ status: 'unavailable', worker: 'health_check_failed' });
  }
});
// Cadastro e login permanecem publicos. Rotas autenticadas devem ser registradas
// em um plugin separado com o authMiddleware como hook onRequest.
await app.register(authRoutes, { prefix: '/api/v1/auth' });
await app.register(protectedRoutes, { prefix: '/api/v1' });
const studentProfileModule = createStudentProfileModule();
await app.register(async (profileApp) => studentProfileRoutes(profileApp, studentProfileModule.controller), { prefix: '/api/v1' });
const studentAccessModule = createStudentAccessModule();
await app.register(async (accessApp) => studentAccessRoutes(accessApp, studentAccessModule.controller), { prefix: '/api/v1' });
const entitlementRedis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
const entitlementRepository = new PaymentEntitlementRepository();
const entitlementService = new EntitlementService(
  entitlementRepository,
  new RedisEntitlementCache(entitlementRedis, env.ASAAS_ENV),
);
await app.register(async (accessApp) => entitlementRoutes(accessApp, new EntitlementController(entitlementService, entitlementRepository.findStudentIdByUserId.bind(entitlementRepository))), { prefix: '/api/v1' });
const studentFlashcardsModule = createStudentFlashcardsModule({ access: studentAccessModule.service });
await app.register(async (flashcardsApp) => studentFlashcardsRoutes(flashcardsApp, studentFlashcardsModule.controller), { prefix: '/api/v1' });
await app.register(async (simulationApp) => registerWeeklySimulationModule(simulationApp, studentAccessModule.repository), { prefix: '/api/v1/student' });
await app.register(teacherRoutes, { prefix: '/api/v1/teachers' });
await app.register(profileImageRoutes, { prefix: '/api/v1/teachers' });
await app.register(profileImageRoutes, { prefix: '/api/v1/student' });
await app.register(profileImageRoutes, { prefix: '/api/v1' });
await app.register(monitorRoutes, { prefix: '/api/v1/monitors' });
await app.register(documentRoutes, { prefix: '/api/v1/monitors' });
await app.register(contentReviewRoutes, { prefix: '/api/v1/monitors' });
await app.register(questionRoutes, { prefix: '/api/v1/questions' });
await app.register(studentPurchaseRoutes, { prefix: '/api/v1/student' });
await app.register(registerDailyChallgensModule, { prefix: '/api/v1/student' });
await app.register(studentQuestionAttemptRoutes, { prefix: '/api/v1/student' });
await app.register(teacherPracticePreviewRoutes, { prefix: '/api/v1/teacher/practice-preview' });
await app.register(studentConsistencyRoutes, { prefix: '/api/v1/student' });
await app.register(studentPerformanceRoutes, { prefix: '/api/v1/student' });
await app.register(studentExperienceRoutes, { prefix: '/api/v1/student' });
await app.register(chatRoutes, { prefix: '/api/v1' });
await app.register(studentContentReportRoutes, { prefix: '/api/v1/student' });
const paymentsWebhookModule = createPaymentsWebhookModule();
await app.register(async (paymentsApp) => asaasWebhookRoutes(paymentsApp, paymentsWebhookModule.controller), { prefix: '/api/v1' });
const paymentAccountModule = createPaymentAccountModule();
await app.register(async (paymentsApp) => paymentAccountRoutes(paymentsApp, paymentAccountModule.controller), { prefix: '/api/v1' });
await app.register(async (paymentsApp) => paymentAccountCredentialRoutes(paymentsApp, paymentAccountModule.rotateCredential), { prefix: '/api/v1' });
if (env.PAYMENTS_PROVIDER === 'ASAAS') {
  const paymentsModule = createPaymentsModule({
    apiKey: selectAsaasApiKey(env.ASAAS_ENV, { sandbox: env.ASAAS_API_KEY_SANDBOX, production: env.ASAAS_API_KEY }) ?? '',
    baseUrl: getAsaasBaseUrl(env.ASAAS_ENV),
    environment: env.ASAAS_ENV,
    timeoutMs: env.ASAAS_HTTP_TIMEOUT_MS,
    returnBaseUrl: env.PAYMENTS_RETURN_BASE_URL ?? env.PUBLIC_FRONT_URL ?? 'http://localhost:3000',
    invalidateAccess: (studentId, reason) => entitlementService.invalidate(studentId, reason),
  });
  await app.register(async (paymentsApp) => paymentsRoutes(paymentsApp, paymentsModule.controller, paymentsModule.subscriptionController, paymentsModule.teacherPayoutController), { prefix: '/api/v1' });
}


app.setErrorHandler(createErrorHandler());

await app.listen({ host: env.HOST, port: env.PORT });
