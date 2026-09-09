import type { ChatRagResult } from '../models/chat-rag.model.js';
import type {
  ChatEvidenceCachePort,
  FlashcardEvidenceCacheInput,
  QuestionEvidenceCacheInput,
} from '../ports/question-evidence.port.js';

export const CHAT_EVIDENCE_CACHE_TTL_SECONDS = 5 * 60 * 60;

type RedisEvidenceClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
};

type EvidenceKind = 'QUESTION' | 'FLASHCARD';

type StoredEvidence = {
  version: 1;
  kind: EvidenceKind;
  evidenceId: string;
  teacherId: string;
  monitorId: string;
  subjectId: string;
  rag: ChatRagResult;
};

export class RedisChatEvidenceRepository implements ChatEvidenceCachePort {
  constructor(private readonly redis: RedisEvidenceClient) {}

  getQuestion(input: QuestionEvidenceCacheInput) {
    return this.get('QUESTION', input.questionId, input);
  }

  setQuestion(input: QuestionEvidenceCacheInput, result: ChatRagResult) {
    return this.set('QUESTION', input.questionId, input, result);
  }

  getFlashcard(input: FlashcardEvidenceCacheInput) {
    return this.get('FLASHCARD', input.flashcardId, input);
  }

  setFlashcard(input: FlashcardEvidenceCacheInput, result: ChatRagResult) {
    return this.set('FLASHCARD', input.flashcardId, input, result);
  }

  private async get(
    kind: EvidenceKind,
    evidenceId: string,
    scope: { teacherId: string; monitorId: string; subjectId: string },
  ): Promise<ChatRagResult | null> {
    const value = await this.redis.get(buildChatEvidenceKey(kind, { ...scope, evidenceId }));
    if (!value) return null;

    try {
      const stored = JSON.parse(value) as Partial<StoredEvidence>;
      if (
        stored.version !== 1
        || stored.kind !== kind
        || stored.evidenceId !== evidenceId
        || stored.teacherId !== scope.teacherId
        || stored.monitorId !== scope.monitorId
        || stored.subjectId !== scope.subjectId
        || !stored.rag
      ) return null;
      return stored.rag;
    } catch {
      return null;
    }
  }

  private async set(
    kind: EvidenceKind,
    evidenceId: string,
    scope: { teacherId: string; monitorId: string; subjectId: string },
    result: ChatRagResult,
  ): Promise<void> {
    const stored: StoredEvidence = {
      version: 1,
      kind,
      evidenceId,
      teacherId: scope.teacherId,
      monitorId: scope.monitorId,
      subjectId: scope.subjectId,
      rag: {
        ...result,
        retrievalQuery: '',
      },
    };
    await this.redis.set(
      buildChatEvidenceKey(kind, { ...scope, evidenceId }),
      JSON.stringify(stored),
      'EX',
      CHAT_EVIDENCE_CACHE_TTL_SECONDS,
    );
  }
}

export function buildChatEvidenceKey(
  kind: EvidenceKind,
  input: { teacherId: string; monitorId: string; subjectId: string; evidenceId: string },
) {
  return `chat:rag:evidence:v1:${kind}:${input.teacherId}:${input.monitorId}:${input.subjectId}:${input.evidenceId}`;
}
