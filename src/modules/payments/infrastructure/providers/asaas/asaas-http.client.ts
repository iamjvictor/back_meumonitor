export type AsaasHttpRequest = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
};

export type AsaasHttpClientConfig = {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

export class AsaasApiError extends Error {
  constructor(
    readonly status: number,
    message = `Asaas request failed (${status})`,
    readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = 'AsaasApiError';
  }
}

export class AsaasHttpClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: AsaasHttpClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async request<T>(path: string, request: AsaasHttpRequest): Promise<T> {
    const startedAt = Date.now();
    console.log('Requisição HTTP para Asaas iniciada', {
      event: 'payments.asaas_http_started',
      method: request.method,
      path,
      hasBody: request.body !== undefined,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, '')}${path}`, {
        method: request.method,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          access_token: this.config.apiKey,
          'user-agent': 'MeuMonitorAI',
        },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const responseText = await response.text().catch(() => '');
        let responseBody: unknown = responseText;
        try {
          responseBody = responseText ? JSON.parse(responseText) : null;
        } catch {
          // Mantém o texto bruto quando a API não responder JSON.
        }
        const providerMessage = extractProviderErrorMessage(responseBody);
        console.warn('Asaas respondeu com erro HTTP', {
          event: 'payments.asaas_http_failed',
          method: request.method,
          path,
          status: response.status,
          providerMessage,
          responseBody,
          durationMs: Date.now() - startedAt,
        });
        throw new AsaasApiError(response.status, providerMessage ? `Asaas request failed (${response.status}): ${providerMessage}` : undefined, responseBody);
      }

      if (response.status === 204) {
        console.log('Requisição HTTP para Asaas concluída', { event: 'payments.asaas_http_completed', method: request.method, path, status: response.status, durationMs: Date.now() - startedAt });
        return undefined as T;
      }
      const payload = (await response.json()) as T;
      console.log('Requisição HTTP para Asaas concluída', { event: 'payments.asaas_http_completed', method: request.method, path, status: response.status, durationMs: Date.now() - startedAt });
      return payload;
    } catch (error) {
      if (controller.signal.aborted) {
        console.warn('Requisição HTTP para Asaas expirou', { event: 'payments.asaas_http_timeout', method: request.method, path, durationMs: Date.now() - startedAt });
        throw new Error('Asaas request timed out');
      }
      console.warn('Requisição HTTP para Asaas falhou', { event: 'payments.asaas_http_exception', method: request.method, path, durationMs: Date.now() - startedAt, errorType: error instanceof Error ? error.name : 'UnknownError', errorMessage: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function extractProviderErrorMessage(body: unknown) {
  if (!body || typeof body !== 'object') return typeof body === 'string' ? body : undefined;
  const candidate = body as { message?: unknown; errors?: Array<{ code?: unknown; description?: unknown }> };
  if (Array.isArray(candidate.errors) && candidate.errors.length > 0) {
    return candidate.errors.map((error) => [error.code, error.description].filter(Boolean).join(': ')).join('; ');
  }
  return typeof candidate.message === 'string' ? candidate.message : undefined;
}
