import type { ChatGenerationInput } from '../models/chat-generation.model.js';

export type ChatGenerationResult = {
  content: string;
};

export interface ChatGenerationPort {
  generate(input: ChatGenerationInput): Promise<ChatGenerationResult>;
}
