import type { OpenRouterClient, ChatCompletionResult } from '../../../worker/client/openrouter.client.js';
import type { ChatGenerationPort } from '../ports/chat-generation.port.js';
import type { ChatGenerationInput, ChatPromptMessage } from '../models/chat-generation.model.js';
import { ChatPromptBuilder } from '../services/chat-prompt.builder.js';

type ChatClient = Pick<OpenRouterClient, 'createChatCompletion'>;

export type OpenRouterChatGatewayConfig = {
  model: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
};

export class ChatGenerationError extends Error {
  constructor(
    readonly code: 'CHAT_GENERATION_FAILED' | 'CHAT_GENERATION_TIMEOUT' | 'CHAT_GENERATION_EMPTY',
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

export class OpenRouterChatGateway implements ChatGenerationPort {
  constructor(
    private readonly client: ChatClient,
    private readonly promptBuilder = new ChatPromptBuilder(),
    private readonly config: OpenRouterChatGatewayConfig,
  ) {}

  async generate(input: ChatGenerationInput) {
    const messages = this.promptBuilder.build(input);

    try {
      const response = await this.client.createChatCompletion({
        messages,
        model: this.config.model,
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
        timeoutMs: this.config.timeoutMs,
      });

      return { content: normalizeResponse(response) };
    } catch (error) {
      if (error instanceof ChatGenerationError) throw error;
      if (isTimeoutError(error)) {
        throw new ChatGenerationError(
          'CHAT_GENERATION_TIMEOUT',
          'A geração da resposta excedeu o tempo limite.',
          error,
        );
      }
      if (isEmptyResponseError(error)) {
        throw new ChatGenerationError(
          'CHAT_GENERATION_EMPTY',
          'A IA não retornou uma resposta válida.',
          error,
        );
      }
      throw new ChatGenerationError(
        'CHAT_GENERATION_FAILED',
        'Não foi possível gerar a resposta do chat.',
        error,
      );
    }
  }
}

function normalizeResponse(response: ChatCompletionResult) {
  const content = response.content.trim();
  if (!content) {
    throw new ChatGenerationError('CHAT_GENERATION_EMPTY', 'A IA não retornou uma resposta válida.');
  }
  return content;
}

function isTimeoutError(error: unknown) {
  return isStructuredErrorWithCode(error, 'TIMEOUT');
}

function isEmptyResponseError(error: unknown) {
  return isStructuredErrorWithCode(error, 'EMPTY_RESPONSE');
}

function isStructuredErrorWithCode(error: unknown, code: string) {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === code);
}
