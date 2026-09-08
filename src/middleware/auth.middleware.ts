import type { FastifyReply, FastifyRequest } from 'fastify';
import { supabaseAuth } from '../lib/supabase.js';
import { AppError } from '../core/errors/app-error.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: { id: string; email?: string; fullName?: string; whatsapp?: string; role?: string } | null;
  }
}

interface CachedUserSession {
  user: { id: string; email?: string; fullName?: string; whatsapp?: string; role?: string };
  expiresAt: number;
}

const sessionCache = new Map<string, CachedUserSession>();

function getTokenExpirationMs(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadSegment = parts[1];
    if (!payloadSegment) return null;
    const payloadJson = Buffer.from(payloadSegment, 'base64url').toString('utf-8');
    const payload = JSON.parse(payloadJson) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

// Cleanup expired cache items every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessionCache.entries()) {
    if (session.expiresAt <= now) {
      sessionCache.delete(token);
    }
  }
}, 5 * 60 * 1000);

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  if (request.method === 'OPTIONS') {
    return;
  }

  const authorization = request.headers.authorization;
  const cookieAccessToken = request.cookies.mm_access_token;
  const accessToken = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : cookieAccessToken;

  if (!accessToken) {
    console.log('Sessao nao enviada', { event: 'auth.session_missing', requestId: request.id, url: request.url });
    throw new AppError({ code: 'UNAUTHENTICATED', statusCode: 401, publicMessage: 'Sessao de usuario obrigatoria.' });
  }

  // Fast path: check in-memory cache
  const now = Date.now();
  const cached = sessionCache.get(accessToken);
  if (cached) {
    if (cached.expiresAt > now) {
      request.user = cached.user;
      return;
    }
    sessionCache.delete(accessToken);
  }

  console.log('Verificando sessao com Supabase', {
    event: 'auth.session_check',
    requestId: request.id,
    hasAuthorizationHeader: Boolean(authorization),
    hasAccessTokenCookie: Boolean(cookieAccessToken),
  });

  const { data, error } = await supabaseAuth.auth.getUser(accessToken);

  if (error || !data.user) {
    sessionCache.delete(accessToken);
    console.log('Sessao invalida ou expirada', { event: 'auth.session_invalid', requestId: request.id, providerMessage: error?.message });
    throw new AppError({ code: 'UNAUTHENTICATED', statusCode: 401, publicMessage: 'Sessao invalida ou expirada.' });
  }

  const userObj = {
    id: data.user.id,
    email: data.user.email,
    fullName: data.user.user_metadata?.full_name || data.user.user_metadata?.fullName || data.user.user_metadata?.name,
    whatsapp: data.user.user_metadata?.whatsapp,
    role: data.user.app_metadata?.role,
  };

  // Cache duration: 60s max, or up to the exact JWT expiration timestamp (whichever comes first)
  const tokenExpMs = getTokenExpirationMs(accessToken);
  const maxCacheDurationMs = 60 * 1000;
  const expiresAt = tokenExpMs
    ? Math.min(now + maxCacheDurationMs, tokenExpMs)
    : now + maxCacheDurationMs;

  if (expiresAt > now) {
    sessionCache.set(accessToken, { user: userObj, expiresAt });
  }

  request.user = userObj;
  console.log('Sessao validada', { event: 'auth.session_validated', requestId: request.id, userId: data.user.id });
}
