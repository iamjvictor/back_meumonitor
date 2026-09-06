import assert from 'node:assert/strict';
import test from 'node:test';

function setBackendEnv() {
  process.env.NODE_ENV = 'test';
  process.env.HOST = '127.0.0.1';
  process.env.PORT = '3000';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.DATABASE_URL = 'postgresql://postgres:password@localhost:5432/test';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
  process.env.OPENROUTER_EMBEDDING_MODEL = 'openrouter/test-embedding';
  process.env.OPENROUTER_QUESTION_MODEL = 'openrouter/test-chat';
}

test('persists a valid generated card as pending review with its source chunk', async () => {
  setBackendEnv();
  const { FlashcardGenerationService } = await import('../flashcard/flashcard-generation.service.js');
  const persisted: unknown[] = [];

  const service = new FlashcardGenerationService({
    client: {
      async createStructuredChatCompletion() {
        return {
          eligible: true, reason: 'CONCEPTUAL_CONTENT', flashcards: [{
            front: 'O que é fotossíntese?',
            back: 'É a conversão de energia luminosa em energia química pelas plantas.',
            evidence: ['A fotossíntese converte energia luminosa em energia química nas plantas.'],
            kind: 'DEFINITION',
            difficulty: 'EASY',
            topicId: 'topic-1',
          }],
        };
      },
    } as never,
    repository: {
      async findChunkForFlashcardGeneration() {
        return {
          id: 'chunk-1',
          content: 'A fotossíntese converte energia luminosa em energia química nas plantas.',
          status: 'READY',
          block: { type: 'DEFINITION' },
          document: {
            teacherId: 'teacher-1',
            monitorId: 'monitor-1',
            subjectId: 'subject-1',
          },
          topicLinks: [{ topicId: 'topic-1' }],
        };
      },
      async persistFlashcards(rows: unknown[]) {
        persisted.push(...rows);
        return { savedCount: rows.length, duplicateCount: 0 };
      },
    },
    models: { primary: 'openai/gpt-5-mini', fallback: null },
  });

  const result = await service.generateForChunk('chunk-1');

  assert.deepEqual(result, { generated: 1, accepted: 1, persisted: 1, rejected: 0, duplicates: 0, rejectedReasons: {} });
  assert.deepEqual(persisted, [{
    teacherId: 'teacher-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
    topicId: 'topic-1',
    front: 'O que é fotossíntese?',
    back: 'É a conversão de energia luminosa em energia química pelas plantas.',
    kind: 'DEFINITION',
    difficulty: 'EASY',
    generationOrigin: 'AI_GENERATED',
    status: 'PENDING_REVIEW',
    sourceChunkIds: ['chunk-1'],
  }]);
});

test('envia schema estrito e prompt com o contrato completo dos cards', async () => {
  setBackendEnv();
  const { FlashcardGenerationService } = await import('../flashcard/flashcard-generation.service.js');
  let request: any;
  const service = new FlashcardGenerationService({
    client: {
      async createStructuredChatCompletion(input: any) {
        request = input;
        return input.validate({
          eligible: true, reason: 'CONCEPTUAL_CONTENT', flashcards: [{
            front: 'O que é fotossíntese?', back: 'Conversão de luz em energia.',
            evidence: ['A fotossíntese converte luz em energia.'], kind: 'DEFINITION',
            difficulty: 'EASY', topicId: 'topic-1',
          }],
        });
      },
    } as never,
    repository: {
      async findChunkForFlashcardGeneration() {
        return {
          id: 'chunk-1', content: 'A fotossíntese converte luz em energia.', status: 'READY', block: { type: 'DEFINITION' },
          document: { teacherId: 't', monitorId: 'm', subjectId: 's' }, topicLinks: [{ topicId: 'topic-1' }],
        };
      },
      async persistFlashcards(rows: unknown[]) { return { savedCount: rows.length, duplicateCount: 0 }; },
    },
    models: { primary: 'p', fallback: null },
  });

  await service.generateForChunk('chunk-1');

  const itemSchema = request.schema.properties.flashcards.items;
  assert.deepEqual(itemSchema.required, ['front', 'back', 'evidence', 'kind', 'difficulty', 'topicId']);
  assert.deepEqual(Object.keys(itemSchema.properties).sort(), ['back', 'difficulty', 'evidence', 'front', 'kind', 'topicId']);
  assert.match(request.messages[0].content, /front.*back.*evidence.*kind.*difficulty.*topicId/s);
  assert.match(request.messages[0].content, /literal.*allowedTopicIds|allowedTopicIds.*literal/s);
  assert.match(request.messages[0].content, /pergunta aut[oô]noma/i);
  assert.match(request.messages[0].content, /F[oó]rmula de|Enunciado de|Defini[cç][aã]o de/i);
  assert.match(request.messages[0].content, /uma [uú]nica ideia/i);
  assert.match(request.messages[0].content, /trecho.*passagem.*se[cç][aã]o/i);
  assert.match(request.messages[0].content, /listad.*anunciad.*mencionad/i);
});

test('não aceita formato legado sourceQuote/type nem card sem topicId', async () => {
  setBackendEnv();
  const { FlashcardGenerationService } = await import('../flashcard/flashcard-generation.service.js');
  let persisted = 0;
  const service = new FlashcardGenerationService({
    client: { async createStructuredChatCompletion() {
      return {
        eligible: true, reason: 'CONCEPTUAL_CONTENT', flashcards: [
          { front: 'legado', back: 'legado', sourceQuote: 'texto', type: 'DEFINITION', topicId: 'topic-1' },
          { front: 'sem tópico', back: 'texto', evidence: ['texto'], kind: 'DEFINITION', difficulty: null },
        ],
      };
    } } as never,
    repository: {
      async findChunkForFlashcardGeneration() {
        return {
          id: 'chunk-legacy', content: 'A fotossíntese converte energia luminosa em energia química nas plantas.', status: 'READY', block: { type: 'DEFINITION' },
          document: { teacherId: 't', monitorId: 'm', subjectId: 's' }, topicLinks: [{ topicId: 'topic-1' }],
        };
      },
      async persistFlashcards(rows: unknown[]) { persisted = rows.length; return { savedCount: persisted, duplicateCount: 0 }; },
    },
    models: { primary: 'p', fallback: null },
  });

  assert.deepEqual(await service.generateForChunk('chunk-legacy'), { generated: 2, accepted: 0, persisted: 0, rejected: 2, duplicates: 0, rejectedReasons: { INVALID_SCHEMA: 2 } });
});

test('does not call the model for a raw QUESTION block', async () => {
  setBackendEnv();
  const { FlashcardGenerationService } = await import('../flashcard/flashcard-generation.service.js');
  let modelCalls = 0;
  const service = new FlashcardGenerationService({
    client: { async createStructuredChatCompletion() { modelCalls += 1; return { eligible: true, reason: 'CONCEPTUAL_CONTENT', flashcards: [] }; } } as never,
    repository: {
      async findChunkForFlashcardGeneration() {
        return {
          id: 'chunk-question', content: 'Qual é a relação entre massa, força e aceleração?', status: 'READY',
          block: { type: 'QUESTION' },
          document: { teacherId: 'teacher-1', monitorId: 'monitor-1', subjectId: 'subject-1' },
          topicLinks: [{ topicId: 'topic-1' }],
        };
      },
      async persistFlashcards() { return { savedCount: 0, duplicateCount: 0 }; },
    },
  });

  assert.deepEqual(await service.generateForChunk('chunk-question'), { generated: 0, persisted: 0, rejected: 0 });
  assert.equal(modelCalls, 0);
});

test('uses configured fallback when structured response fails local schema validation', async () => {
  setBackendEnv();
  const { FlashcardGenerationService } = await import('../flashcard/flashcard-generation.service.js');
  const models: string[] = [];
  const service = new FlashcardGenerationService({
    client: {
      async createStructuredChatCompletion(input: { model?: string; validate?: (value: unknown) => unknown }) {
        models.push(input.model ?? 'missing');
        if (models.length === 1) return input.validate?.({ eligible: true, reason: 'CONCEPTUAL_CONTENT', flashcards: 'invalid' });
        return input.validate?.({
          eligible: true, reason: 'CONCEPTUAL_CONTENT',
          flashcards: [{
            front: 'O que é fotossíntese?',
            back: 'É a conversão de energia luminosa em energia química pelas plantas.',
            evidence: ['A fotossíntese converte energia luminosa em energia química nas plantas.'],
            kind: 'DEFINITION', difficulty: 'EASY', topicId: 'topic-1',
          }],
        });
      },
    } as never,
    repository: {
      async findChunkForFlashcardGeneration() {
        return {
          id: 'chunk-1', content: 'A fotossíntese converte energia luminosa em energia química nas plantas.', status: 'READY',
          block: { type: 'DEFINITION' },
          document: { teacherId: 'teacher-1', monitorId: 'monitor-1', subjectId: 'subject-1' },
          topicLinks: [{ topicId: 'topic-1' }],
        };
      },
      async persistFlashcards(rows: unknown[]) { return { savedCount: rows.length, duplicateCount: 0 }; },
    },
    models: { primary: 'primary-model', fallback: 'fallback-model' },
  });

  assert.deepEqual(await service.generateForChunk('chunk-1'), { generated: 1, accepted: 1, persisted: 1, rejected: 0, duplicates: 0, rejectedReasons: {} });
  assert.deepEqual(models, ['primary-model', 'fallback-model']);
});

test('respects configured concurrency and isolates failed chunks', async () => {
  setBackendEnv();
  const { FlashcardGenerationService } = await import('../flashcard/flashcard-generation.service.js');
  let active = 0;
  let peak = 0;
  const service = new FlashcardGenerationService({
    client: {
      async createStructuredChatCompletion(input: { messages: Array<{ content: string }> }) {
        active += 1;
        peak = Math.max(peak, active);
        const content = input.messages[1]?.content ?? '';
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        if (content.includes('chunk-fail')) throw new Error('chunk failure');
        return { eligible: true, reason: 'CONCEPTUAL_CONTENT', flashcards: [] };
      },
    } as never,
    repository: {
      async findFlashcardGenerationChunkIds() { return ['chunk-1', 'chunk-fail', 'chunk-2']; },
      async findChunkForFlashcardGeneration(chunkId: string) {
        return {
          id: chunkId, content: `Conteúdo conceitual suficiente para ${chunkId}.`, status: 'READY',
          block: { type: 'THEORY' }, document: { teacherId: 't', monitorId: 'm', subjectId: 's' },
          topicLinks: [{ topicId: 'topic-1' }],
        };
      },
      async persistFlashcards() { return { savedCount: 0, duplicateCount: 0 }; },
    },
  });

  assert.deepEqual(await service.processDocument('document-1', 2), {
    generated: 0, accepted: 0, persisted: 0, rejected: 0, duplicates: 0, rejectedReasons: {}, failedChunks: 1, ineligibleReasons: {}, attemptedChunks: 3, successfulChunks: 2,
    failedChunksDetail: [{ chunkId: 'chunk-fail', code: 'PROVIDER_ERROR' }], status: 'PARTIAL_SUCCESS',
  });
  assert.equal(peak, 2);
});

test('reports failed chunk ids and FAILED when every attempted chunk fails', async () => {
  setBackendEnv();
  const { FlashcardGenerationService } = await import('../flashcard/flashcard-generation.service.js');
  const service = new FlashcardGenerationService({
    client: { async createStructuredChatCompletion() { throw new Error('provider unavailable'); } } as never,
    repository: {
      async findFlashcardGenerationChunkIds() { return ['chunk-a', 'chunk-b']; },
      async findChunkForFlashcardGeneration(id: string) { return { id, content: 'Conteúdo conceitual suficiente.', status: 'READY', block: { type: 'THEORY' }, document: { teacherId: 't', monitorId: 'm', subjectId: 's' }, topicLinks: [{ topicId: 'topic-1' }] }; },
      async persistFlashcards() { return { savedCount: 0, duplicateCount: 0 }; },
    },
    models: { primary: 'primary', fallback: null },
  });
  assert.deepEqual(await service.processDocument('document-1', 1), {
    generated: 0, accepted: 0, persisted: 0, rejected: 0, duplicates: 0, rejectedReasons: {}, attemptedChunks: 2, successfulChunks: 0,
    failedChunks: 2, ineligibleReasons: {}, failedChunksDetail: [{ chunkId: 'chunk-a', code: 'PROVIDER_ERROR' }, { chunkId: 'chunk-b', code: 'PROVIDER_ERROR' }], status: 'FAILED',
  });
});

test('keeps valid candidates when one envelope item is structurally invalid', async () => {
  setBackendEnv();
  const { FlashcardGenerationService } = await import('../flashcard/flashcard-generation.service.js');
  const persisted: unknown[] = [];
  const service = new FlashcardGenerationService({
    client: { async createStructuredChatCompletion(input: any) { return input.validate({ eligible: true, reason: 'CONCEPTUAL_CONTENT', flashcards: [{ front: 'O que é fotossíntese?', back: 'É conversão de energia.', evidence: ['A fotossíntese converte energia.'], kind: 'DEFINITION', difficulty: 'EASY', topicId: 'topic-1' }, { front: 7 }] }); } } as never,
    repository: { async findChunkForFlashcardGeneration() { return { id: 'c', content: 'A fotossíntese converte energia.', status: 'READY', block: { type: 'DEFINITION' }, document: { teacherId: 't', monitorId: 'm', subjectId: 's' }, topicLinks: [{ topicId: 'topic-1' }] }; }, async persistFlashcards(rows: unknown[]) { persisted.push(...rows); return { savedCount: rows.length, duplicateCount: 0 }; } },
    models: { primary: 'p', fallback: null },
  });
  assert.deepEqual(await service.generateForChunk('c'), {
    generated: 2,
    accepted: 1,
    persisted: 1,
    rejected: 1,
    duplicates: 0,
    rejectedReasons: { INVALID_SCHEMA: 1 },
  });
  assert.equal(persisted.length, 1);
});

test('reports distinct rejection reasons without leaking candidate content', async () => {
  setBackendEnv();
  const { FlashcardGenerationService } = await import('../flashcard/flashcard-generation.service.js');
  const service = new FlashcardGenerationService({
    client: { async createStructuredChatCompletion(input: any) {
      return input.validate({
        eligible: true,
        reason: 'CONCEPTUAL_CONTENT',
        flashcards: [
          { front: 'O que é fotossíntese?', back: 'É conversão de energia.', evidence: ['A fotossíntese converte energia.'], kind: 'DEFINITION', difficulty: 'EASY', topicId: 'topic-1' },
          { front: 'O que é um conceito inválido?', back: 'Resposta válida.', evidence: ['A fotossíntese converte energia.'], kind: 'DEFINITION', difficulty: 'EASY', topicId: 'invented-topic' },
          { front: 'O que é evidência falsa?', back: 'Resposta válida.', evidence: ['texto que não existe no chunk'], kind: 'DEFINITION', difficulty: 'EASY', topicId: 'topic-1' },
          { front: 7 },
        ],
      });
    } } as never,
    repository: {
      async findChunkForFlashcardGeneration() { return { id: 'c', content: 'A fotossíntese converte energia.', status: 'READY', block: { type: 'DEFINITION' }, document: { teacherId: 't', monitorId: 'm', subjectId: 's' }, topicLinks: [{ topicId: 'topic-1' }] }; },
      async persistFlashcards(rows: unknown[]) { return { savedCount: rows.length, duplicateCount: 0 }; },
    },
    models: { primary: 'p', fallback: null },
  });

  assert.deepEqual(await service.generateForChunk('c'), {
    generated: 4,
    accepted: 1,
    persisted: 1,
    rejected: 3,
    duplicates: 0,
    rejectedReasons: { INVALID_TOPIC: 1, UNGROUNDED_EVIDENCE: 1, INVALID_SCHEMA: 1 },
  });
});

test('separates persistence duplicates from quality rejections', async () => {
  setBackendEnv();
  const { FlashcardGenerationService } = await import('../flashcard/flashcard-generation.service.js');
  const service = new FlashcardGenerationService({
    client: { async createStructuredChatCompletion(input: any) {
      return input.validate({ eligible: true, reason: 'CONCEPTUAL_CONTENT', flashcards: [{ front: 'O que é fotossíntese?', back: 'É conversão de energia.', evidence: ['A fotossíntese converte energia.'], kind: 'DEFINITION', difficulty: 'EASY', topicId: 'topic-1' }] });
    } } as never,
    repository: {
      async findChunkForFlashcardGeneration() { return { id: 'c', content: 'A fotossíntese converte energia.', status: 'READY', block: { type: 'DEFINITION' }, document: { teacherId: 't', monitorId: 'm', subjectId: 's' }, topicLinks: [{ topicId: 'topic-1' }] }; },
      async persistFlashcards() { return { savedCount: 0, duplicateCount: 1 }; },
    },
    models: { primary: 'p', fallback: null },
  });

  assert.deepEqual(await service.generateForChunk('c'), {
    generated: 1,
    accepted: 1,
    persisted: 0,
    rejected: 0,
    duplicates: 1,
    rejectedReasons: {},
  });
});

test('accepts eligible response with cards', async () => {
  setBackendEnv();
  const { FlashcardGenerationService } = await import('../flashcard/flashcard-generation.service.js');
  let persisted = 0;
  const service = new FlashcardGenerationService({
    client: { async createStructuredChatCompletion() { return { eligible: true, reason: 'CONCEPTUAL_CONTENT', flashcards: [{ front: 'O que é fotossíntese?', back: 'É a conversão de energia.', evidence: ['A fotossíntese converte energia.'], kind: 'DEFINITION', difficulty: 'EASY', topicId: 'topic-1' }] }; } } as never,
    repository: { async findChunkForFlashcardGeneration() { return { id: 'c', content: 'A fotossíntese converte energia.', status: 'READY', block: { type: 'DEFINITION' }, document: { teacherId: 't', monitorId: 'm', subjectId: 's' }, topicLinks: [{ topicId: 'topic-1' }] }; }, async persistFlashcards(rows: unknown[]) { persisted = rows.length; return { savedCount: persisted, duplicateCount: 0 }; } },
    models: { primary: 'p', fallback: null },
  });
  assert.deepEqual(await service.generateForChunk('c'), { generated: 1, accepted: 1, persisted: 1, rejected: 0, duplicates: 0, rejectedReasons: {} });
});

test('does not persist an ineligible response with empty cards and preserves reason in document summary', async () => {
  setBackendEnv();
  const { FlashcardGenerationService } = await import('../flashcard/flashcard-generation.service.js');
  const { sanitizeFlashcardOutputSummary } = await import('../document-worker.service.js');
  let persistCalls = 0;
  const service = new FlashcardGenerationService({
    client: { async createStructuredChatCompletion() { return { eligible: false, reason: 'EXERCISE_ONLY', flashcards: [] }; } } as never,
    repository: { async findChunkForFlashcardGeneration() { return { id: 'c', content: 'Resolva o exercício.', status: 'READY', block: { type: 'THEORY' }, document: { teacherId: 't', monitorId: 'm', subjectId: 's' }, topicLinks: [{ topicId: 'topic-1' }] }; }, async persistFlashcards() { persistCalls += 1; return { savedCount: 0, duplicateCount: 0 }; } },
    models: { primary: 'p', fallback: null },
  });
  const result = await service.generateForChunk('c');
  assert.deepEqual(result, { generated: 0, persisted: 0, rejected: 0, ineligibleReason: 'EXERCISE_ONLY' });
  assert.equal(persistCalls, 0);
  assert.equal(sanitizeFlashcardOutputSummary({ ineligibleReasons: { EXERCISE_ONLY: 1 } }).ineligibleReasons && 'EXERCISE_ONLY' in (sanitizeFlashcardOutputSummary({ ineligibleReasons: { EXERCISE_ONLY: 1 } }).ineligibleReasons as object), true);
});

test('aggregates the model ineligibility reason per document', async () => {
  setBackendEnv();
  const { FlashcardGenerationService } = await import('../flashcard/flashcard-generation.service.js');
  const service = new FlashcardGenerationService({
    client: { async createStructuredChatCompletion() { return { eligible: false, reason: 'NO_STUDY_VALUE', flashcards: [] }; } } as never,
    repository: { async findFlashcardGenerationChunkIds() { return ['c']; }, async findChunkForFlashcardGeneration() { return { id: 'c', content: 'Texto sem valor de revisão.', status: 'READY', block: { type: 'THEORY' }, document: { teacherId: 't', monitorId: 'm', subjectId: 's' }, topicLinks: [{ topicId: 'topic-1' }] }; }, async persistFlashcards() { throw new Error('não deveria persistir'); } },
    models: { primary: 'p', fallback: null },
  });
  assert.deepEqual((await service.processDocument('document-1')).ineligibleReasons, { NO_STUDY_VALUE: 1 });
});

test('rejects an ineligible response containing cards', async () => {
  setBackendEnv();
  const { FlashcardGenerationService } = await import('../flashcard/flashcard-generation.service.js');
  const service = new FlashcardGenerationService({ client: { async createStructuredChatCompletion() { return { eligible: false, reason: 'METADATA', flashcards: [{ front: 'x' }] }; } } as never, repository: { async findChunkForFlashcardGeneration() { return { id: 'c', content: 'Conteúdo conceitual suficiente.', status: 'READY', block: { type: 'THEORY' }, document: { teacherId: 't', monitorId: 'm', subjectId: 's' }, topicLinks: [{ topicId: 'topic-1' }] }; }, async persistFlashcards() { return { savedCount: 0, duplicateCount: 0 }; } }, models: { primary: 'p', fallback: null } });
  await assert.rejects(() => service.generateForChunk('c'), /eligible=false/);
});
