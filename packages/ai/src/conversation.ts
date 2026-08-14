import { randomUUID } from 'node:crypto';
import type { ModelMessage } from './types.js';

export interface Conversation {
  id: string;
  userId: string;
  sessionId: string;
  messages: ModelMessage[];
  pendingApprovalId?: string;
}

export class ConversationError extends Error {
  constructor(message = 'Conversation not found or unavailable') {
    super(message);
    this.name = 'ConversationError';
  }
}

export class InMemoryConversationStore {
  private readonly conversations = new Map<string, Conversation>();

  create(userId: string, sessionId: string): Conversation {
    const conversation: Conversation = { id: randomUUID(), userId, sessionId, messages: [] };
    this.conversations.set(conversation.id, conversation);
    return structuredClone(conversation);
  }

  get(id: string, userId: string, sessionId: string): Conversation {
    const conversation = this.conversations.get(id);
    if (!conversation || conversation.userId !== userId || conversation.sessionId !== sessionId) {
      throw new ConversationError();
    }
    return structuredClone(conversation);
  }

  save(conversation: Conversation): void {
    const existing = this.conversations.get(conversation.id);
    if (
      !existing ||
      existing.userId !== conversation.userId ||
      existing.sessionId !== conversation.sessionId
    ) {
      throw new ConversationError();
    }
    this.conversations.set(conversation.id, structuredClone(conversation));
  }
}
