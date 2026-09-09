import type { PrismaClient } from '@prisma/client';
import type { FlashcardEvidenceResult } from '../models/flashcard-evidence.model.js';
import type { FlashcardEvidenceInput, FlashcardEvidencePort } from '../ports/flashcard-evidence.port.js';
import { buildFlashcardEvidenceContext } from '../services/flashcard-evidence.context.js';

type FlashcardEvidenceClient = Pick<PrismaClient, 'flashcard'>;

export class PrismaFlashcardEvidenceProvider implements FlashcardEvidencePort {
  constructor(private readonly client: FlashcardEvidenceClient) {}

  async get(input: FlashcardEvidenceInput): Promise<FlashcardEvidenceResult | null> {
    const startedAt = Date.now();
    const flashcard = await this.client.flashcard.findFirst({
      where: {
        id: input.flashcardId,
        teacherId: input.teacherId,
        monitorId: input.monitorId,
        subjectId: input.subjectId,
        status: 'APPROVED',
      },
      select: {
        id: true,
        front: true,
        back: true,
        topicId: true,
        sources: {
          select: {
            chunkId: true,
            chunk: {
              select: {
                id: true,
                documentId: true,
                blockId: true,
                content: true,
                status: true,
                pageStart: true,
                pageEnd: true,
              },
            },
          },
        },
      },
    });

    if (!flashcard) return null;

    const citations = flashcard.sources
      .filter((source) => source.chunk.status === 'READY')
      .map((source) => ({
        chunkId: source.chunk.id,
        documentId: source.chunk.documentId,
        blockId: source.chunk.blockId,
        content: source.chunk.content,
        pageStart: source.chunk.pageStart,
        pageEnd: source.chunk.pageEnd,
      }))
      .filter((citation) => citation.content.trim().length > 0);
    const context = buildFlashcardEvidenceContext({
      strategy: 'DIRECT_FLASHCARD_SOURCE',
      sufficient: Boolean(flashcard.front.trim() && flashcard.back.trim()),
      flashcardId: flashcard.id,
      front: flashcard.front,
      back: flashcard.back,
      topicId: flashcard.topicId,
      citations,
      context: '',
      metrics: { sourceCount: citations.length, chunkCount: citations.length, durationMs: 0 },
    });

    return {
      strategy: 'DIRECT_FLASHCARD_SOURCE',
      sufficient: Boolean(flashcard.front.trim() && flashcard.back.trim()),
      flashcardId: flashcard.id,
      front: flashcard.front,
      back: flashcard.back,
      topicId: flashcard.topicId,
      citations,
      context,
      metrics: {
        sourceCount: citations.length,
        chunkCount: citations.length,
        durationMs: Date.now() - startedAt,
      },
    };
  }
}

function formatPageRange(start: number | null, end: number | null) {
  if (start === null && end === null) return 'não informada';
  if (start === end || end === null) return `${start}`;
  return `${start}-${end}`;
}
