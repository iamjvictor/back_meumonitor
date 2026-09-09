import type { ChatRagInput, ChatRagResult } from '../models/chat-rag.model.js';

export interface ChatKnowledgePort {
  retrieve(input: ChatRagInput): Promise<ChatRagResult>;
}
