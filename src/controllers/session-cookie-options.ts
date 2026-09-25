type RequestProtocol = {
  protocol?: string;
  headers?: unknown;
};

export function sessionCookieOptions(request: RequestProtocol) {
  const headers = request.headers as Record<string, string | string[] | undefined> | undefined;
  const forwardedProtocol = headers?.['x-forwarded-proto'];
  const protocol = Array.isArray(forwardedProtocol) ? forwardedProtocol[0] : forwardedProtocol;
  const secure = request.protocol === 'https' || protocol === 'https';

  return {
    secure,
    sameSite: secure ? 'none' as const : 'lax' as const,
    path: '/',
  };
}
