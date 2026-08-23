import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { corsOrigins, env } from './config/env.js';
import { authRoutes } from './routes/auth.routes.js';
import { protectedRoutes } from './routes/protected.routes.js';
import { teacherRoutes } from './routes/teacher.routes.js';
import { profileImageRoutes } from './routes/profile-image.routes.js';
import { monitorRoutes } from './routes/monitor.routes.js';
import { documentRoutes } from './routes/document.routes.js';
import { contentReviewRoutes } from './routes/content-review.routes.js';
import { questionRoutes } from './routes/question.routes.js';

// Railway terminates HTTPS at the public edge; the Node process listens on HTTP internally.
const app = Fastify({
  trustProxy: true,
  logger: false,
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
    const cleaned = origin.trim().replace(/\/+$/, '');
    if (
      corsOrigins.includes(cleaned) ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(cleaned) ||
      env.NODE_ENV === 'development'
    ) {
      return cb(null, true);
    }
    return cb(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Cookie'],
});
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

app.get('/health', async () => ({ status: 'ok' }));
// Cadastro e login permanecem publicos. Rotas autenticadas devem ser registradas
// em um plugin separado com o authMiddleware como hook onRequest.
await app.register(authRoutes, { prefix: '/api/v1/auth' });
await app.register(protectedRoutes, { prefix: '/api/v1' });
await app.register(teacherRoutes, { prefix: '/api/v1/teachers' });
await app.register(profileImageRoutes, { prefix: '/api/v1/teachers' });
await app.register(monitorRoutes, { prefix: '/api/v1/monitors' });
await app.register(documentRoutes, { prefix: '/api/v1/monitors' });
await app.register(contentReviewRoutes, { prefix: '/api/v1/monitors' });
await app.register(questionRoutes, { prefix: '/api/v1/questions' });


app.setErrorHandler((error, request, reply) => {
  console.log('Erro nao tratado na requisicao', { error });
  return reply.code(500).send({ error: 'INTERNAL_SERVER_ERROR', message: 'Erro interno do servidor.' });
});

await app.listen({ host: env.HOST, port: env.PORT });
