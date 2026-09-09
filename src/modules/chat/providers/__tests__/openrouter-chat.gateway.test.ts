import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatPromptMessage } from '../../models/chat-generation.model.js';
import { ChatGenerationError, OpenRouterChatGateway } from '../openrouter-chat.gateway.js';

class FixedPromptBuilder {
  calls: unknown[] = [];

  build(input: unknown): ChatPromptMessage[] {
    this.calls.push(input);
    return [
      { role: 'system', content: 'sistema' },
      { role: 'user', content: 'mensagem' },
    ];
  }
}

test('gateway transforma o contrato do chat em completion textual', async () => {
  const promptBuilder = new FixedPromptBuilder();
  const calls: unknown[] = [];
  const gateway = new OpenRouterChatGateway(
    {
      async createChatCompletion(input) {
        calls.push(input);
        return {
          content: '  Resposta final.  ',
          usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        };
      },
    },
    promptBuilder,
    { model: 'chat-model', maxTokens: 500, temperature: 0.3, timeoutMs: 10_000 },
  );

  const result = await gateway.generate({
    message: 'Explique.',
    history: [],
    questionContext: null,
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
  });

  assert.equal(result.content, 'Resposta final.');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    messages: [
      { role: 'system', content: 'sistema' },
      { role: 'user', content: 'mensagem' },
    ],
    model: 'chat-model',
    maxTokens: 500,
    temperature: 0.3,
    timeoutMs: 10_000,
  });
  assert.equal(promptBuilder.calls.length, 1);
});

test('gateway converte falha do provider em erro estável do chat', async () => {
  const gateway = new OpenRouterChatGateway(
    {
      async createChatCompletion() {
        throw new Error('detalhe interno do provedor');
      },
    },
    new FixedPromptBuilder(),
    { model: 'chat-model', maxTokens: 500, temperature: 0.3, timeoutMs: 10_000 },
  );

  await assert.rejects(
    gateway.generate({
      message: 'Explique.',
      history: [],
      questionContext: null,
      monitorId: 'monitor-1',
      subjectId: 'subject-1',
    }),
    (error: unknown) => error instanceof ChatGenerationError && error.code === 'CHAT_GENERATION_FAILED',
  );
});
