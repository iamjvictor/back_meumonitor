export type AsaasHttpRequest = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Credential for a scoped subaccount request; never included in logs. */
  credential?: string;
  environment?: 'sandbox' | 'production';
};

export type AsaasHttpClientConfig = {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  environment?: 'sandbox' | 'production';
  fetchImpl?: typeof fetch;
};

export class AsaasApiError extends Error {
  constructor(
    readonly status: number,
    message = `Asaas request failed (${status})`,
    readonly responseBody?: { code?: string; descriptions?: string[] },
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
    if (request.environment && this.config.environment && request.environment !== this.config.environment) {
      throw new Error('Asaas environment mismatch');
    }
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
          access_token: request.credential ?? this.config.apiKey,
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
        const providerError = extractProviderError(responseBody);
        console.warn('Asaas respondeu com erro HTTP', {
          event: 'payments.asaas_http_failed',
          method: request.method,
          path,
          status: response.status,
          providerCode: providerError?.code,
          providerErrorCount: providerError?.descriptions.length ?? 0,
          providerErrorDescriptions: providerError?.descriptions,
          durationMs: Date.now() - startedAt,
        });
        throw new AsaasApiError(response.status, `Asaas request failed (${response.status})`, providerError);
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

function extractProviderError(body: unknown): { code?: string; descriptions: string[] } | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const candidate = body as { message?: unknown; errors?: Array<{ code?: unknown; description?: unknown }> };
  if (Array.isArray(candidate.errors) && candidate.errors.length > 0) {
    const rawCode = candidate.errors.find((error) => typeof error.code === 'string')?.code;
    const code = typeof rawCode === 'string' ? rawCode : undefined;
    const descriptions = candidate.errors
      .map((error) => typeof error.description === 'string' ? sanitizeProviderDescription(error.description) : null)
      .filter((description): description is string => Boolean(description))
      .slice(0, 5);
    return code || descriptions.length > 0 ? { code: code?.slice(0, 80), descriptions } : undefined;
  }
  return undefined;
}

function sanitizeProviderDescription(value: string): string {
  return value
    .replace(/\b(api[ _-]?key|token|password|senha|cpf|cnpj)\b/gi, '[sensitive-field]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\d{8,}/g, '[number]')
    .slice(0, 240);
}
