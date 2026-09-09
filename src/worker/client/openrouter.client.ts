import { env } from '../../config/env.js';
import { aiModels } from '../../config/ai-models.config.js';

const EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings';

type EmbeddingResponse = {
  data?: Array<{
    index: number;
    embedding: number[];
  }>;
  error?: {
    message?: string;
  };
  usage?: { prompt_tokens?: number; total_tokens?: number };
};

type ChatResponse = {
  choices?: Array<{
    finish_reason?: string | null;
    native_finish_reason?: string | null;
    message?: { content?: string | null };
  }>;
  error?: { message?: string };
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

export type StructuredRequestUsage = {
  model: string;
  schemaName: string;
  statusCode: number;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  finishReason?: string | null;
};

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ChatCompletionResult = {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
};

export class StructuredCompletionError extends Error {
  constructor(
    readonly code:
      | 'MODEL_OUTPUT_TRUNCATED'
      | 'EMPTY_RESPONSE'
      | 'INVALID_JSON'
      | 'INVALID_SCHEMA'
      | 'RATE_LIMITED'
      | 'PROVIDER_ERROR'
      | 'TIMEOUT',
    message: string,
    readonly details: {
      model: string;
      finishReason?: string | null;
      nativeFinishReason?: string | null;
      statusCode?: number;
      retryAfterMs?: number;
      validationError?: unknown;
      responseContent?: string | null;
    } = { model: '' },
  ) {
    super(message);
  }
}

export class OpenRouterClient {
  async createEmbeddings(input: string[], options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<number[][]> {
    console.log('Validando cliente do OpenRouter', {
      event: 'monitor.openrouter_client_validation_started',
      inputCount: input.length,
      hasApiKey: Boolean(env.OPENROUTER_API_KEY),
      model: env.OPENROUTER_EMBEDDING_MODEL,
      dimensions: env.OPENROUTER_EMBEDDING_DIMENSIONS,
    });

    if (!env.OPENROUTER_API_KEY) {
      console.log('OpenRouter rejeitado: chave ausente', {
        event: 'monitor.openrouter_client_validation_failed',
        reason: 'OPENROUTER_API_KEY ausente',
      });
      throw new Error('OPENROUTER_API_KEY nao configurada para o worker.');
    }

    if (input.length === 0) {
      console.log('Chamada ao OpenRouter ignorada: lote vazio', {
        event: 'monitor.openrouter_client_empty_input',
      });
      return [];
    }

    console.log('Solicitando embeddings ao OpenRouter', {
      event: 'monitor.embedding_request_started',
      model: env.OPENROUTER_EMBEDDING_MODEL,
      inputCount: input.length,
      inputChars: input.reduce((total, value) => total + value.length, 0),
    });

    const requestStartedAt = Date.now();
    const controller = new AbortController();
    const timeout = options.timeoutMs
      ? setTimeout(() => controller.abort(), options.timeoutMs)
      : undefined;
    options.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    if (options.signal?.aborted) controller.abort();

    try {
      const response = await fetch(EMBEDDINGS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: env.OPENROUTER_EMBEDDING_MODEL,
          input,
          dimensions: env.OPENROUTER_EMBEDDING_DIMENSIONS,
          encoding_format: 'float',
        }),
      });

      console.log('Resposta recebida do OpenRouter', {
        event: 'monitor.embedding_http_response_received',
        statusCode: response.status,
        ok: response.ok,
        durationMs: Date.now() - requestStartedAt,
      });

      const payload = (await Promise.race([
        response.json(),
        new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
      ])) as EmbeddingResponse;
      if (!response.ok || !payload.data) {
        console.log('OpenRouter retornou erro de embeddings', {
          event: 'monitor.embedding_request_failed',
          statusCode: response.status,
          message: payload.error?.message || 'resposta invalida',
        });
        throw new Error(
          `OpenRouter embeddings falhou (${response.status}): ${payload.error?.message || 'resposta invalida'}`,
        );
      }

      const embeddings = [...payload.data]
        .sort((left, right) => left.index - right.index)
        .map((item) => item.embedding);

      if (
        embeddings.length !== input.length ||
        embeddings.some((embedding) => embedding.length !== env.OPENROUTER_EMBEDDING_DIMENSIONS)
      ) {
        throw new Error('OpenRouter retornou quantidade ou dimensao de embeddings inesperada.');
      }

      console.log('Embeddings recebidos do OpenRouter', {
        event: 'monitor.embedding_request_completed',
        model: env.OPENROUTER_EMBEDDING_MODEL,
        embeddingCount: embeddings.length,
        dimensions: embeddings[0]?.length || 0,
        promptTokens: payload.usage?.prompt_tokens,
        totalTokens: payload.usage?.total_tokens,
      });

      return embeddings;
    } catch (error) {
      if (controller.signal.aborted) {
        console.log('Embedding interrompido por timeout', {
          event: 'monitor.embedding_request_timeout',
          model: env.OPENROUTER_EMBEDDING_MODEL,
          timeoutMs: options.timeoutMs,
          durationMs: Date.now() - requestStartedAt,
        });
        const timeoutError = new Error('OpenRouter embeddings excedeu o timeout configurado.');
        timeoutError.name = 'EMBEDDING_TIMEOUT';
        throw timeoutError;
      }
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async createChatCompletion(input: {
    messages: ChatMessage[];
    model?: string;
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<ChatCompletionResult> {
    if (!env.OPENROUTER_API_KEY) {
      throw new Error('OPENROUTER_API_KEY nao configurada para o worker.');
    }

    const model = input.model ?? env.OPENROUTER_QUESTION_MODEL;
    const requestStartedAt = Date.now();
    console.log('[openrouter.client.ts] Solicitação de geração iniciada', {
      event: 'monitor.chat_generation_request_started',
      model,
      messageCount: input.messages.length,
      inputChars: input.messages.reduce((total, message) => total + message.content.length, 0),
      maxTokens: input.maxTokens ?? 600,
      temperature: input.temperature ?? 0.2,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? env.OPENROUTER_STRUCTURED_TIMEOUT_MS);
    input.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    if (input.signal?.aborted) controller.abort();

    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: input.messages,
          temperature: input.temperature ?? 0.2,
          max_tokens: input.maxTokens ?? 600,
          reasoning: { effort: aiModels.reasoningEffort },
        }),
      });

      const payload = (await Promise.race([
        response.json(),
        new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
      ])) as ChatResponse;
      const content = payload.choices?.[0]?.message?.content?.trim();
      const finishReason = payload.choices?.[0]?.finish_reason;

      console.log('[openrouter.client.ts] Resposta HTTP da geração recebida', {
        event: 'monitor.chat_generation_http_response_received',
        model,
        statusCode: response.status,
        ok: response.ok,
        finishReason,
        durationMs: Date.now() - requestStartedAt,
      });

      if (!response.ok) {
        const code = response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_ERROR';
        throw new StructuredCompletionError(
          code,
          `OpenRouter chat falhou (${response.status}).`,
          { model, statusCode: response.status, finishReason },
        );
      }
      if (finishReason === 'length') {
        throw new StructuredCompletionError(
          'MODEL_OUTPUT_TRUNCATED',
          'A resposta do chat terminou por limite de tokens.',
          { model, finishReason },
        );
      }
      if (!content) {
        throw new StructuredCompletionError(
          'EMPTY_RESPONSE',
          'OpenRouter nao retornou conteudo para o chat.',
          { model, finishReason },
        );
      }

      console.log('[openrouter.client.ts] Geração concluída', {
        event: 'monitor.chat_generation_request_completed',
        model,
        finishReason,
        durationMs: Date.now() - requestStartedAt,
      promptTokens: payload.usage?.prompt_tokens,
      completionTokens: payload.usage?.completion_tokens,
      totalTokens: payload.usage?.total_tokens,
      responseChars: content.length,
      responsePreview: env.NODE_ENV === 'production' ? undefined : content.slice(0, 500),
    });

      return {
        content,
        usage: {
          promptTokens: payload.usage?.prompt_tokens ?? 0,
          completionTokens: payload.usage?.completion_tokens ?? 0,
          totalTokens: payload.usage?.total_tokens ?? 0,
        },
      };
    } catch (error) {
      console.log('[openrouter.client.ts] Geração falhou', {
        event: 'monitor.chat_generation_request_failed',
        model,
        durationMs: Date.now() - requestStartedAt,
        reason: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      });
      if (controller.signal.aborted) {
        throw new StructuredCompletionError('TIMEOUT', 'OpenRouter excedeu o timeout configurado.', { model });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async createStructuredChatCompletion<T>(input: {
    messages: ChatMessage[];
    schemaName: string;
    schema: Record<string, unknown>;
    maxTokens?: number;
    model?: string;
    temperature?: number;
    requireParameters?: boolean;
    validate?: (value: unknown) => T;
    onUsage?: (usage: StructuredRequestUsage) => void;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<T> {
    if (!env.OPENROUTER_API_KEY) {
      throw new Error('OPENROUTER_API_KEY nao configurada para o worker.');
    }

    console.log('Solicitando analise estruturada ao OpenRouter', {
      event: 'monitor.llm_structured_request_started',
      model: input.model ?? env.OPENROUTER_QUESTION_MODEL,
      schemaName: input.schemaName,
      maxTokens: input.maxTokens ?? 2048,
      temperature: input.temperature ?? 0,
      requireParameters: input.requireParameters ?? false,
      messageCount: input.messages.length,
      inputChars: input.messages.reduce((total, message) => total + message.content.length, 0),
    });

    const requestStartedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? env.OPENROUTER_STRUCTURED_TIMEOUT_MS);
    input.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    if (input.signal?.aborted) controller.abort();
    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
        signal: controller.signal,
      body: JSON.stringify({
        model: input.model ?? env.OPENROUTER_QUESTION_MODEL,
        messages: input.messages,
        temperature: input.temperature ?? 0,
        max_tokens: input.maxTokens ?? 2048,
        response_format: {
          type: 'json_schema',
          json_schema: { name: input.schemaName, strict: true, schema: input.schema },
        },
        reasoning: { effort: aiModels.reasoningEffort },
        ...(input.requireParameters ? { provider: { require_parameters: true } } : {}),
      }),
      });
      const payload = (await Promise.race([
        response.json(),
        new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
      ])) as ChatResponse;
      return await this.parseStructuredResponse(payload, response, input, requestStartedAt);
    } catch (error) {
      if (controller.signal.aborted) throw new StructuredCompletionError('TIMEOUT', 'OpenRouter excedeu o timeout configurado.', { model: input.model ?? env.OPENROUTER_QUESTION_MODEL });
      throw error;
    } finally { clearTimeout(timeout); }
  }

  private async parseStructuredResponse<T>(payload: ChatResponse, response: Response, input: {
    messages: ChatMessage[]; schemaName: string; schema: Record<string, unknown>; validate?: (value: unknown) => T;
    model?: string; onUsage?: (usage: StructuredRequestUsage) => void;
  }, requestStartedAt: number): Promise<T> {
    const content = payload.choices?.[0]?.message?.content;

    const durationMs = Date.now() - requestStartedAt;
    const usage: StructuredRequestUsage = {
      model: input.model ?? env.OPENROUTER_QUESTION_MODEL,
      schemaName: input.schemaName,
      statusCode: response.status,
      durationMs,
      promptTokens: payload.usage?.prompt_tokens ?? 0,
      completionTokens: payload.usage?.completion_tokens ?? 0,
      totalTokens: payload.usage?.total_tokens ?? 0,
      finishReason: payload.choices?.[0]?.finish_reason,
    };
    input.onUsage?.(usage);

    console.log('Resposta da analise estruturada recebida', {
      event: 'monitor.llm_structured_response_received',
      statusCode: response.status,
      ok: response.ok,
      durationMs,
      responseChars: content?.length || 0,
      promptTokens: payload.usage?.prompt_tokens,
      completionTokens: payload.usage?.completion_tokens,
      totalTokens: payload.usage?.total_tokens,
      finishReason: payload.choices?.[0]?.finish_reason,
      nativeFinishReason: payload.choices?.[0]?.native_finish_reason,
    });

    const model = input.model ?? env.OPENROUTER_QUESTION_MODEL;
    const finishReason = payload.choices?.[0]?.finish_reason;
    if (!response.ok) {
      const statusCode = response.status;
      if (statusCode === 429) {
        throw new StructuredCompletionError(
          'RATE_LIMITED',
          `OpenRouter chat falhou (${statusCode}): ${payload.error?.message || 'too many requests'}`,
          {
            model,
            finishReason,
            statusCode,
            retryAfterMs: parseRetryAfterMilliseconds(response.headers.get('retry-after')),
          },
        );
      }
      throw new StructuredCompletionError(
        'PROVIDER_ERROR',
        `OpenRouter chat falhou (${statusCode}): ${payload.error?.message || 'resposta vazia'}`,
        { model, finishReason, statusCode },
      );
    }

    if (finishReason === 'length') {
      throw new StructuredCompletionError(
        'MODEL_OUTPUT_TRUNCATED',
        'A resposta estruturada terminou por limite de tokens.',
        { model, finishReason },
      );
    }

    if (!content?.trim()) {
      throw new StructuredCompletionError(
        'EMPTY_RESPONSE',
        'OpenRouter nao retornou conteudo estruturado.',
        { model, finishReason },
      );
    }

    try {
      const parsed = JSON.parse(content) as unknown;
      if (!input.validate) {
        return parsed as T;
      }
      try {
        return input.validate(parsed);
      } catch (error) {
        console.log('Resposta estruturada nao atende ao schema local', {
          event: 'monitor.llm_structured_schema_validation_failed',
          schemaName: input.schemaName,
          error,
        });
        throw new StructuredCompletionError(
          'INVALID_SCHEMA',
          'OpenRouter retornou uma resposta que nao atende ao schema local.',
          {
            model,
            finishReason,
            nativeFinishReason: payload.choices?.[0]?.native_finish_reason,
            validationError: serializeValidationError(error),
            responseContent: content?.slice(0, 4_000) ?? null,
          },
        );
      }
    } catch (error) {
      if (error instanceof StructuredCompletionError) {
        throw error;
      }
      console.log('Resposta estruturada nao era um JSON valido', {
        event: 'monitor.llm_structured_json_parse_failed',
        schemaName: input.schemaName,
        error,
      });
      throw new StructuredCompletionError(
        'INVALID_JSON',
        'OpenRouter retornou uma resposta que nao pode ser interpretada como JSON.',
        { model, finishReason },
      );
    }
  }
}

function serializeValidationError(error: unknown) {
  if (!error || typeof error !== 'object') return error;
  const candidate = error as { message?: unknown; issues?: unknown };
  return {
    message: typeof candidate.message === 'string' ? candidate.message : undefined,
    issues: Array.isArray(candidate.issues) ? candidate.issues.slice(0, 8) : undefined,
  };
}

function parseRetryAfterMilliseconds(value: string | null) {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return undefined;

  return Math.max(0, timestamp - Date.now());
}
