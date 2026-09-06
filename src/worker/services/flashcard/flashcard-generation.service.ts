import { z } from 'zod';
import { aiModels } from '../../../config/ai-models.config.js';
import { findChunkForFlashcardGeneration, findFlashcardGenerationChunkIds } from '../../../repositories/document-worker.repository.js';
import {
  saveGeneratedFlashcards,
  type FlashcardPersistenceInput,
} from '../../../repositories/flashcard.repository.js';
import { OpenRouterClient } from '../../client/openrouter.client.js';
import { computeFlashcardFrontHash, isFlashcardEligible, validateFlashcardCandidate } from './flashcard-quality.service.js';
import type { FlashcardCandidate, FlashcardDifficulty, FlashcardKind } from './flashcard.types.js';

const MAX_CANDIDATES_PER_CHUNK = 5;

const candidateSchema = z.object({
  front: z.string(),
  back: z.string(),
  evidence: z.array(z.string()).min(1),
  kind: z.enum(['DEFINITION', 'FORMULA', 'RULE', 'EXCEPTION', 'APPLICATION']),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).nullable(),
  topicId: z.string().min(1),
});

const eligibilityReasonSchema = z.enum(['CONCEPTUAL_CONTENT', 'EXERCISE_ONLY', 'METADATA', 'TEACHER_GUIDE', 'ANSWER_KEY', 'INSUFFICIENT_CONTEXT', 'DUPLICATE_CONTENT', 'NO_STUDY_VALUE']);
const responseSchema = z.object({
  eligible: z.boolean(), reason: eligibilityReasonSchema, flashcards: z.array(z.unknown()).max(MAX_CANDIDATES_PER_CHUNK),
}).superRefine((value, ctx) => {
  if (!value.eligible && value.flashcards.length > 0) ctx.addIssue({ code: 'custom', message: 'eligible=false exige flashcards vazio' });
});

const FLASHCARD_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false,
  properties: {
    flashcards: {
      type: 'array', maxItems: MAX_CANDIDATES_PER_CHUNK,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          front: { type: 'string' },
          back: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' }, minItems: 1 },
          kind: { type: 'string', enum: ['DEFINITION', 'FORMULA', 'RULE', 'EXCEPTION', 'APPLICATION'] },
          difficulty: { type: ['string', 'null'], enum: ['EASY', 'MEDIUM', 'HARD', null] },
          topicId: { type: 'string', minLength: 1 },
        },
        required: ['front', 'back', 'evidence', 'kind', 'difficulty', 'topicId'],
      },
    },
    eligible: { type: 'boolean' },
    reason: { type: 'string', enum: ['CONCEPTUAL_CONTENT', 'EXERCISE_ONLY', 'METADATA', 'TEACHER_GUIDE', 'ANSWER_KEY', 'INSUFFICIENT_CONTEXT', 'DUPLICATE_CONTENT', 'NO_STUDY_VALUE'] },
  }, required: ['eligible', 'reason', 'flashcards'],
};

type GenerationChunk = {
  id: string; content: string; status: string; block: { type: string } | null;
  document: { teacherId: string; monitorId: string; subjectId: string };
  topicLinks: Array<{ topicId: string }>;
};

type GeneratedCandidate = FlashcardCandidate & { topicId: string; kind: FlashcardKind; difficulty: FlashcardDifficulty | null };
type RejectedReasons = Record<string, number>;

function incrementReason(reasons: RejectedReasons, reason: string) {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}

export type FlashcardGenerationRepository = {
  findChunkForFlashcardGeneration(chunkId: string): Promise<GenerationChunk | null>;
  findFlashcardGenerationChunkIds?(documentId: string): Promise<string[]>;
  persistFlashcards(rows: FlashcardPersistenceInput[]): Promise<{ savedCount: number; duplicateCount: number }>;
};

export type FlashcardGenerationClient = Pick<OpenRouterClient, 'createStructuredChatCompletion'>;

export class FlashcardGenerationService {
  private readonly client: FlashcardGenerationClient;
  private readonly repository: FlashcardGenerationRepository;
  private readonly models: { primary: string; fallback: string | null };

  constructor(dependencies: {
    client?: FlashcardGenerationClient;
    repository?: FlashcardGenerationRepository;
    models?: { primary: string; fallback: string | null };
  } = {}) {
    this.client = dependencies.client ?? new OpenRouterClient();
    this.repository = dependencies.repository ?? {
      findChunkForFlashcardGeneration,
      findFlashcardGenerationChunkIds,
      persistFlashcards: saveGeneratedFlashcards,
    };
    this.models = dependencies.models ?? {
      primary: aiModels.flashcardGeneration,
      fallback: aiModels.flashcardGenerationFallback,
    };
  }

  async processDocument(documentId: string, concurrency = aiModels.flashcardGenerationConcurrency) {
    if (!this.repository.findFlashcardGenerationChunkIds) throw new Error('Repositorio sem selecao de chunks para flashcards.');
    const chunkIds = await this.repository.findFlashcardGenerationChunkIds(documentId);
    let next = 0;
    const results: Array<{ generated: number; accepted?: number; persisted: number; rejected: number; duplicates?: number; rejectedReasons?: RejectedReasons; ineligibleReason?: string }> = [];
    const failedChunksDetail: Array<{ chunkId: string; code: string }> = [];
    let failedChunks = 0;
    const worker = async () => {
      while (next < chunkIds.length) {
        const chunkId = chunkIds[next++];
        if (!chunkId) continue;
        try { results.push(await this.generateForChunk(chunkId)); }
        catch (error) {
          failedChunks += 1;
          failedChunksDetail.push({ chunkId, code: error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : 'PROVIDER_ERROR' });
          console.log('Chunk de flashcards falhou; demais chunks continuarao', {
            event: 'monitor.flashcard_chunk_failed_non_blocking', chunkId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };
    const settled = await Promise.allSettled(Array.from({ length: Math.min(Math.max(1, concurrency), chunkIds.length) }, worker));
    failedChunks += settled.filter((item) => item.status === 'rejected').length;
    const ineligibleReasons = results.reduce<Record<string, number>>((sum, item) => { if (item.ineligibleReason) sum[item.ineligibleReason] = (sum[item.ineligibleReason] ?? 0) + 1; return sum; }, {});
    const rejectedReasons = results.reduce<RejectedReasons>((sum, item) => {
      for (const [reason, count] of Object.entries(item.rejectedReasons ?? {})) sum[reason] = (sum[reason] ?? 0) + count;
      return sum;
    }, {});
    const summary = results.reduce<{ generated: number; accepted: number; persisted: number; rejected: number; duplicates: number; failedChunks: number; ineligibleReasons: Record<string, number>; rejectedReasons: RejectedReasons }>((sum, item) => ({
      generated: sum.generated + item.generated, persisted: sum.persisted + item.persisted,
      accepted: sum.accepted + (item.accepted ?? 0), rejected: sum.rejected + item.rejected,
      duplicates: sum.duplicates + (item.duplicates ?? 0), failedChunks, ineligibleReasons, rejectedReasons,
    }), { generated: 0, accepted: 0, persisted: 0, rejected: 0, duplicates: 0, failedChunks, ineligibleReasons, rejectedReasons });
    return { ...summary, attemptedChunks: chunkIds.length, successfulChunks: chunkIds.length - failedChunks, failedChunksDetail, status: chunkIds.length > 0 && failedChunks === chunkIds.length ? 'FAILED' as const : failedChunks > 0 ? 'PARTIAL_SUCCESS' as const : 'READY' as const };
  }

  async generateForChunk(chunkId: string): Promise<{ generated: number; accepted?: number; persisted: number; rejected: number; duplicates?: number; rejectedReasons?: RejectedReasons; ineligibleReason?: string }> {
    const context = await this.repository.findChunkForFlashcardGeneration(chunkId);
    if (!context || context.status !== 'READY' || !context.block || context.block.type === 'QUESTION'
      || !isFlashcardEligible(context.block.type, context.content)) {
      return { generated: 0, persisted: 0, rejected: 0 };
    }
    const allowedTopicIds = new Set(context.topicLinks.map((link) => link.topicId));
    if (allowedTopicIds.size === 0) return { generated: 0, persisted: 0, rejected: 0 };

    let raw: z.infer<typeof responseSchema>;
    try {
      raw = await this.requestCandidates(context, [...allowedTopicIds]);
    } catch (primaryError) {
      if (!this.models.fallback) throw primaryError;
      raw = await this.requestCandidates(context, [...allowedTopicIds], this.models.fallback);
    }
    raw = responseSchema.parse(raw);
    const response = raw;
    if (!response.eligible) return { generated: 0, persisted: 0, rejected: 0, ineligibleReason: response.reason };
    const valid: GeneratedCandidate[] = [];
    const rejectedReasons: RejectedReasons = {};
    let rejected = 0;
    for (const item of response.flashcards) {
      const parsed = candidateSchema.safeParse(item);
      if (!parsed.success) {
        incrementReason(rejectedReasons, 'INVALID_SCHEMA');
        rejected += 1;
        continue;
      }
      if (!allowedTopicIds.has(parsed.data.topicId)) {
        incrementReason(rejectedReasons, 'INVALID_TOPIC');
        rejected += 1;
        continue;
      }
      const validation = validateFlashcardCandidate(parsed.data, context.content);
      if (!validation.valid) {
        incrementReason(rejectedReasons, validation.reason);
        rejected += 1;
        continue;
      }
      valid.push(parsed.data);
    }
    const persistedResult = await this.persistCandidates(valid, context);
    return {
      generated: response.flashcards.length,
      accepted: valid.length,
      persisted: persistedResult.persisted,
      rejected,
      duplicates: persistedResult.duplicates,
      rejectedReasons,
    };
  }

  async persistCandidates(candidates: GeneratedCandidate[], context: GenerationChunk): Promise<{ persisted: number; duplicates: number }> {
    const seen = new Set<string>();
    const rows: FlashcardPersistenceInput[] = [];
    for (const candidate of candidates) {
      if (!validateFlashcardCandidate(candidate, context.content).valid) continue;
      const dedupeKey = `${candidate.topicId}:${computeFlashcardFrontHash(candidate.front)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      rows.push({
        teacherId: context.document.teacherId, monitorId: context.document.monitorId, subjectId: context.document.subjectId,
        topicId: candidate.topicId, front: candidate.front, back: candidate.back,
        kind: candidate.kind, difficulty: candidate.difficulty,
        generationOrigin: 'AI_GENERATED', status: 'PENDING_REVIEW', sourceChunkIds: [context.id],
      });
    }
    if (rows.length === 0) return { persisted: 0, duplicates: 0 };
    const result = await this.repository.persistFlashcards(rows);
    return { persisted: result.savedCount, duplicates: result.duplicateCount ?? Math.max(0, rows.length - result.savedCount) };
  }

  private requestCandidates(context: GenerationChunk, topicIds: string[], model = this.models.primary) {
    return this.client.createStructuredChatCompletion<z.infer<typeof responseSchema>>({
      model, schemaName: 'flashcard_generation', schema: FLASHCARD_RESPONSE_SCHEMA,
      messages: [
        { role: 'system', content: 'Analise exclusivamente o chunk e decida se ha conteudo autonomo com valor de estudo. Rejeite titulos, rotulos, metadados, instrucoes docentes, gabaritos sem explicacao, exercicios sem conceito explicito, listas, texto incompleto, exemplos sem regra e conteudo sem valor de revisao. Retorne apenas JSON com eligible, reason e no maximo cinco flashcards; se eligible=false, flashcards deve ser []. Cada flashcard deve conter exatamente front, back, evidence, kind, difficulty e topicId. A frente deve ser uma pergunta autonoma, clara e especifica de recuperacao ativa, indicando exatamente qual informacao o aluno deve recuperar. Teste uma unica ideia principal por card, sem pedir para explicar tudo ou listar assuntos de uma secao. Nunca use apenas titulos, rotulos ou comandos nominais como "Formula de...", "Enunciado de..." ou "Definicao de..."; transforme-os em perguntas como "Como se calcula..." ou "Qual relacao descreve...?". Evite perguntas vagas como "Qual e a formula?" e referencias dependentes do documento como "acima", "abaixo", "no texto", "no trecho", "na passagem", "na secao", "na figura", "isso", "o caso anterior", ou perguntas sobre itens "listados", "anunciados" ou "mencionados" em um trecho. A pergunta deve fazer sentido isoladamente, sem depender de figura, trecho, passagem, titulo de secao ou contexto omitido. Escolha o formato conforme o conhecimento: DEFINITION para o que e/caracteriza, FORMULA para como calcular ou qual expressao representa, RULE para quando aplicar ou qual condicao, EXCEPTION para quando nao se aplica, APPLICATION para efeito, uso ou situacao concreta. evidence deve ser um array com ao menos uma citacao literal do chunk; kind deve ser DEFINITION, FORMULA, RULE, EXCEPTION ou APPLICATION; difficulty deve ser EASY, MEDIUM, HARD ou null; topicId deve ser copiado exatamente de allowedTopicIds. Nao use conhecimento externo.' },
        { role: 'user', content: JSON.stringify({ chunkId: context.id, blockType: context.block?.type, allowedTopicIds: topicIds, content: context.content }) },
      ],
      validate: (value) => responseSchema.parse(value),
    });
  }
}
