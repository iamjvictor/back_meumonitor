import { env } from '../../config/env.js';

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
    message?: { content?: string | null };
  }>;
  error?: { message?: string };
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

type ChatMessage = {
  role: 'system' | 'user';
  content: string;
};

export class StructuredCompletionError extends Error {
  constructor(
    readonly code: 'MODEL_OUTPUT_TRUNCATED' | 'EMPTY_RESPONSE' | 'INVALID_JSON' | 'INVALID_SCHEMA' | 'PROVIDER_ERROR',
    message: string,
    readonly details: { model: string; finishReason?: string | null } = { model: '' },
  ) {
    super(message);
  }
}

export class OpenRouterClient {
  async createEmbeddings(input: string[]): Promise<number[][]> {
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
    const response = await fetch(EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
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

    const payload = (await response.json()) as EmbeddingResponse;
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
  }

  async createStructuredChatCompletion<T>(input: {
    messages: ChatMessage[];
    schemaName: string;
    schema: Record<string, unknown>;
    maxTokens?: number;
    model?: string;
    temperature?: number;
    requireParameters?: boolean;
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
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: input.model ?? env.OPENROUTER_QUESTION_MODEL,
        messages: input.messages,
        temperature: input.temperature ?? 0,
        max_tokens: input.maxTokens ?? 2048,
        response_format: {
          type: 'json_schema',
          json_schema: { name: input.schemaName, strict: true, schema: input.schema },
        },
        ...(input.requireParameters ? { provider: { require_parameters: true } } : {}),
      }),
    });

    const payload = (await response.json()) as ChatResponse;
    const content = payload.choices?.[0]?.message?.content;

    console.log('Resposta da analise estruturada recebida', {
      event: 'monitor.llm_structured_response_received',
      statusCode: response.status,
      ok: response.ok,
      durationMs: Date.now() - requestStartedAt,
      responseChars: content?.length || 0,
      promptTokens: payload.usage?.prompt_tokens,
      completionTokens: payload.usage?.completion_tokens,
      totalTokens: payload.usage?.total_tokens,
      finishReason: payload.choices?.[0]?.finish_reason,
    });

    const model = input.model ?? env.OPENROUTER_QUESTION_MODEL;
    const finishReason = payload.choices?.[0]?.finish_reason;
    if (!response.ok) {
      throw new StructuredCompletionError(
        'PROVIDER_ERROR',
        `OpenRouter chat falhou (${response.status}): ${payload.error?.message || 'resposta vazia'}`,
        { model, finishReason },
      );
    }

    if (finishReason === 'length') {
      throw new StructuredCompletionError(
        'MODEL_OUTPUT_TRUNCATED',
        'A resposta estruturada terminou por limite de tokens.',
        { model, finishReason },
      );
    }

    if (!content) {
      throw new StructuredCompletionError(
        'EMPTY_RESPONSE',
        'OpenRouter nao retornou conteudo estruturado.',
        { model, finishReason },
      );
    }

    try {
      return JSON.parse(content) as T;
    } catch (error) {
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
