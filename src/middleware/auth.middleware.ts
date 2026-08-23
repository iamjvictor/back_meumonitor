import type { FastifyReply, FastifyRequest } from 'fastify';
import { supabaseAuth } from '../lib/supabase.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: { id: string; email?: string; fullName?: string; whatsapp?: string; role?: string } | null;
  }
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  if (request.method === 'OPTIONS') {
    return;
  }

  const authorization = request.headers.authorization;
  const cookieAccessToken = request.cookies.mm_access_token;
  const accessToken = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : cookieAccessToken;

  console.log('Verificando sessao', {
    event: 'auth.session_check',
    requestId: request.id,
    hasAuthorizationHeader: Boolean(authorization),
    hasAccessTokenCookie: Boolean(cookieAccessToken),
    cookieNames: Object.keys(request.cookies),
  });


  if (!accessToken) {
    console.log('Sessao nao enviada', { event: 'auth.session_missing', requestId: request.id, url: request.url });
    return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sessao de usuario obrigatoria.' });
  }

  const { data, error } = await supabaseAuth.auth.getUser(accessToken);

  if (error || !data.user) {
    console.log('Sessao invalida ou expirada', { event: 'auth.session_invalid', requestId: request.id, providerMessage: error?.message });
    return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sessao invalida ou expirada.' });
  }

  request.user = {
    id: data.user.id,
    email: data.user.email,
    fullName: data.user.user_metadata?.full_name || data.user.user_metadata?.fullName || data.user.user_metadata?.name,
    whatsapp: data.user.user_metadata?.whatsapp,
    role: data.user.app_metadata?.role,
  };
  console.log('Sessao validada', { event: 'auth.session_validated', requestId: request.id, userId: data.user.id });
}
