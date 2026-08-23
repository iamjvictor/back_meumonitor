import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { OpenRouterClient } from '../client/openrouter.client.js';
import {
  findFlashcardSourceBlocks,
  saveGeneratedFlashcards,
  type FlashcardPersistenceInput,
} from '../../repositories/flashcard.repository.js';

const BLOCK_BATCH_SIZE = 5;
const MAX_INPUT_CHARS = 60_000;

const flashcardSchema = z.object({
  front: z.string().trim().min(10).max(300),
  back: z.string().trim().min(2).max(1500),
  kind: z.enum(['DEFINITION', 'FORMULA', 'RULE', 'EXCEPTION', 'APPLICATION']),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).nullable(),
  topicId: z.string().uuid(),
  sourceBlockIndexes: z.array(z.number().int().nonnegative()).min(1),
});

const responseSchema = z.object({ flashcards: z.array(z.unknown()) });

const FLASHCARD_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    flashcards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          front: { type: 'string' },
          back: { type: 'string' },
          kind: { type: 'string', enum: ['DEFINITION', 'FORMULA', 'RULE', 'EXCEPTION', 'APPLICATION'] },
          difficulty: { type: ['string', 'null'], enum: ['EASY', 'MEDIUM', 'HARD', null] },
          topicId: { type: 'string' },
          sourceBlockIndexes: { type: 'array', items: { type: 'integer' }, minItems: 1 },
        },
        required: ['front', 'back', 'kind', 'difficulty', 'topicId', 'sourceBlockIndexes'],
      },
    },
  },
  required: ['flashcards'],
};

export class FlashcardGenerationService {
  constructor(private readonly client = new OpenRouterClient()) {}

  async processDocument(documentId: string) {
    const startedAt = Date.now();
    const blocks = await findFlashcardSourceBlocks(documentId);
    console.log('Fontes didaticas carregadas para flashcards', {
      event: 'monitor.flashcard_source_blocks_loaded',
      documentId,
      blockCount: blocks.length,
      blockTypes: blocks.reduce<Record<string, number>>((counts, block) => {
        counts[block.type] = (counts[block.type] || 0) + 1;
        return counts;
      }, {}),
    });

    if (blocks.length === 0) {
      console.log('Geracao de flashcards ignorada: nenhuma fonte didatica', {
        event: 'monitor.flashcard_generation_skipped',
        documentId,
      });
      return { blockCount: 0, generatedCount: 0, savedCount: 0, duplicateCount: 0, invalidCount: 0 };
    }

    const teacherScope = await this.findDocumentScope(documentId);
    if (!teacherScope) throw new Error('Documento nao encontrado para gerar flashcards.');

    const allCards: Array<z.infer<typeof flashcardSchema>> = [];
    let invalidCount = 0;
    for (let start = 0; start < blocks.length; start += BLOCK_BATCH_SIZE) {
      const batch = blocks.slice(start, start + BLOCK_BATCH_SIZE);
      const allowedTopics = Array.from(new Map(
        batch.flatMap((block) => block.topicLinks
          .filter((link): link is typeof link & { topicId: string; topic: { id: string; name: string } } => Boolean(link.topicId && link.topic))
          .map((link) => [link.topicId, link.topic])),
      ).values());
      const prompt = JSON.stringify({
        allowedTopics,
        blocks: batch.map((block) => ({
          blockIndex: block.blockIndex,
          type: block.type,
          title: block.title,
          content: block.normalizedContent,
        })),
      }).slice(0, MAX_INPUT_CHARS);

      console.log('Solicitando flashcards ao OpenRouter', {
        event: 'monitor.flashcard_llm_batch_started',
        documentId,
        batchNumber: Math.floor(start / BLOCK_BATCH_SIZE) + 1,
        blockIndexes: batch.map((block) => block.blockIndex),
        inputChars: prompt.length,
      });

      try {
        const raw = await this.client.createStructuredChatCompletion<unknown>({
          schemaName: 'flashcard_generation',
          schema: FLASHCARD_SCHEMA,
          messages: [
            {
              role: 'system',
              content: 'Gere flashcards de recuperacao ativa usando exclusivamente os blocos fornecidos. Nao use conhecimento externo. Nao transforme exercicios incompletos em fatos. O front deve ser uma pergunta clara e o back deve responder somente com base na fonte. Use apenas topicId permitido e informe os blockIndexes usados.',
            },
            { role: 'user', content: prompt },
          ],
        });
        const response = responseSchema.parse(raw);
        for (const candidate of response.flashcards) {
          const parsed = flashcardSchema.safeParse(candidate);
          if (parsed.success) allCards.push(parsed.data);
          else {
            invalidCount += 1;
            console.log('Flashcard individual rejeitado na validacao', {
              event: 'monitor.flashcard_validation_failed',
              documentId,
              issues: parsed.error.issues,
            });
          }
        }
      } catch (error) {
        console.log('Lote de flashcards falhou; demais lotes continuarao', {
          event: 'monitor.flashcard_llm_batch_failed_non_blocking',
          documentId,
          blockIndexes: batch.map((block) => block.blockIndex),
          error,
        });
      }
    }

    const validRows: FlashcardPersistenceInput[] = [];
    for (const card of allCards) {
      const sourceBlocks = blocks.filter((block) => card.sourceBlockIndexes.includes(block.blockIndex));
      const topicIsAllowed = sourceBlocks.some((block) => block.topicLinks.some((link) => link.topicId === card.topicId));
      const sourceChunkIds = Array.from(new Set(sourceBlocks.flatMap((block) => block.chunks.map((chunk) => chunk.id))));
      if (!topicIsAllowed || sourceChunkIds.length === 0) {
        invalidCount += 1;
        continue;
      }
      validRows.push({
        teacherId: teacherScope.teacherId,
        monitorId: teacherScope.monitorId,
        subjectId: teacherScope.subjectId,
        topicId: card.topicId,
        front: card.front,
        back: card.back,
        kind: card.kind,
        difficulty: card.difficulty,
        sourceChunkIds,
      });
    }

    const persisted = await saveGeneratedFlashcards(validRows);
    const result = {
      blockCount: blocks.length,
      generatedCount: allCards.length,
      savedCount: persisted.savedCount,
      duplicateCount: persisted.duplicateCount,
      invalidCount,
    };
    console.log('Geracao de flashcards concluida', {
      event: 'monitor.flashcard_generation_completed',
      documentId,
      ...result,
      durationMs: Date.now() - startedAt,
    });
    return result;
  }

  private async findDocumentScope(documentId: string) {
    return prisma.monitorDocument.findUnique({
      where: { id: documentId },
      select: { teacherId: true, monitorId: true, subjectId: true },
    });
  }
}
