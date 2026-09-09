import type { ChatRagInput } from '../models/chat-rag.model.js';

export const MAX_HISTORY_FOR_QUERY = 2;
export const MAX_QUERY_CHARS = 2_000;

export type ChatRetrievalQuery = {
  query: string;
  history: ChatRagInput['history'];
};

export class ChatQueryBuilder {
  build(input: ChatRagInput): ChatRetrievalQuery {
    const history = input.history.slice(-MAX_HISTORY_FOR_QUERY);
    const topic = input.questionContext?.topic?.trim() || input.topicId || 'não informado';
    const topicSection = `[TÓPICO ATUAL]\n${topic}`;
    const historySection = history.length > 0
      ? [
          '[HISTÓRICO RECENTE]',
          ...history.map((message) => `${message.role === 'assistant' ? 'Tutor' : 'Aluno'}: ${message.content}`),
        ].join('\n')
      : '[HISTÓRICO RECENTE]\nNenhuma mensagem anterior.';
    const currentMessage = `[DÚVIDA ATUAL]\n${input.message.trim()}`;
    const base = [topicSection, historySection].join('\n\n');
    const availableBaseChars = Math.max(0, MAX_QUERY_CHARS - currentMessage.length - 2);

    return {
      query: `${base.slice(0, availableBaseChars)}\n\n${currentMessage}`.slice(-MAX_QUERY_CHARS),
      history,
    };
  }
}
