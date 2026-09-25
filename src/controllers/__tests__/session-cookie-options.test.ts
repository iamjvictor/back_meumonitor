import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionCookieOptions } from '../session-cookie-options.js';

test('usa cookie cross-site seguro quando o backend é acessado por HTTPS via proxy', () => {
  assert.deepEqual(sessionCookieOptions({ headers: { 'x-forwarded-proto': 'https' } }), {
    secure: true,
    sameSite: 'none',
    path: '/',
  });
});

test('mantém cookie compatível com localhost HTTP', () => {
  assert.deepEqual(sessionCookieOptions({ headers: {} }), {
    secure: false,
    sameSite: 'lax',
    path: '/',
  });
});
