import type { ChatHistoryMessage, ChatHistoryScope } from '../models/chat-history.model.js';

export interface ChatHistoryPort {
  append(scope: ChatHistoryScope, message: ChatHistoryMessage): Promise<void>;
  list(scope: ChatHistoryScope): Promise<ChatHistoryMessage[]>;
  clear(scope: ChatHistoryScope): Promise<void>;
}
