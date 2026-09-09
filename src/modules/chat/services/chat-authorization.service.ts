import type { ChatAccessInput, ChatAccessPort, ChatScope } from '../ports/chat-access.port.js';

export class ChatAuthorizationService {
  constructor(private readonly access: ChatAccessPort) {}

  async authorize(input: ChatAccessInput): Promise<ChatScope> {
    const scope = await this.access.resolveChatScope(input);
    if (!scope) throw new Error('CHAT_ACCESS_DENIED');
    return scope;
  }
}
