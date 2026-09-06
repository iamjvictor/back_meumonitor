import assert from 'node:assert/strict';
import test from 'node:test';

function setBackendEnv() {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.DATABASE_URL = 'postgresql://postgres:password@localhost:5432/test';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.OPENROUTER_EMBEDDING_MODEL = 'openrouter/test-embedding';
  process.env.OPENROUTER_QUESTION_MODEL = 'openrouter/test-chat';
}

test('rejects a generated flashcard without a source chunk before persistence', async () => {
  setBackendEnv();
  const { saveGeneratedFlashcards } = await import('../flashcard.repository.js');

  await assert.rejects(
    saveGeneratedFlashcards([{
      teacherId: 'teacher-1', monitorId: 'monitor-1', subjectId: 'subject-1', topicId: 'topic-1',
      front: 'O que é fotossíntese?', back: 'Conversão de luz em energia química.',
      kind: 'DEFINITION', difficulty: 'EASY', sourceChunkIds: [],
    }]),
    (error: unknown) => error instanceof Error && error.message.includes('sourceChunkIds'),
  );
});

test('orders unique document ids before acquiring the shared advisory lock', async () => {
  const { acquireDocumentAdvisoryLocks } = await import('../document-advisory-lock.js');
  const locked: string[] = [];
  const transaction = {
    async $executeRaw(_strings: TemplateStringsArray, documentId: string) {
      locked.push(documentId);
    },
  };

  await acquireDocumentAdvisoryLocks(transaction, ['doc-z', 'doc-a', 'doc-z']);

  assert.deepEqual(locked, ['doc-a', 'doc-z']);
});
