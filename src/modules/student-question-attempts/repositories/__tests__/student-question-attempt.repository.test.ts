import assert from 'node:assert/strict';
import test from 'node:test';

test('returns bank images and provenance from the snapshot in the practice payload', async (t) => {
  if (typeof t.mock.module !== 'function') {
    t.skip('Execute com --experimental-test-module-mocks para simular a fronteira Prisma.');
    return;
  }

  let questionQuery: Record<string, any> | undefined;
  const sourceQuestion = {
    id: 'question-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
    topicId: 'topic-1',
    text: 'Enunciado ENEM 2008',
    alternatives: [{ label: 'A', text: 'Alternativa A' }],
    kind: 'MULTIPLE_CHOICE',
    difficulty: 'medium',
    metadata: {
      imageUrls: ['https://cdn.example.org/enem-2008.png'],
      board: null,
      examName: 'ENEM',
      examYear: 2008,
      sourceUrl: 'https://source.example.org/enem/2008/1',
    },
    questionBankItem: {
      imageUrls: [],
      board: null,
      examName: null,
      examYear: null,
      sourceUrl: null,
    },
    subject: { id: 'subject-1', name: 'Matemática' },
    topic: { id: 'topic-1', name: 'Álgebra' },
    questionAttempts: [],
  };
  const fakePrisma = {
    question: {
      async findMany(args: Record<string, any>) {
        questionQuery = args;
        return [sourceQuestion];
      },
      async count() { return 1; },
    },
    studentQuestionAttempt: {
      async count(args: { where?: { isCorrect?: boolean } }) {
        return args.where?.isCorrect ? 0 : 1;
      },
      async findMany() { return []; },
    },
  };
  await t.mock.module('../../../../lib/prisma.js', { namedExports: { prisma: fakePrisma } });

  const { StudentQuestionAttemptRepository } = await import('../student-question-attempt.repository.js');
  const result = await new StudentQuestionAttemptRepository().listApprovedQuestions({
    monitorIds: ['monitor-1'],
    page: 1,
    pageSize: 20,
    studentId: 'student-1',
  });

  const expectedQuestion = Object.fromEntries(
    Object.entries(sourceQuestion).filter(([key]) => key !== 'metadata'),
  );
  assert.deepEqual(result.questions[0], {
    ...expectedQuestion,
    imageUrls: ['https://cdn.example.org/enem-2008.png'],
    provenance: {
      board: null,
      examName: 'ENEM',
      examYear: 2008,
      sourceUrl: 'https://source.example.org/enem/2008/1',
    },
  });
  assert.equal(questionQuery?.select?.metadata, true);
  assert.deepEqual(questionQuery?.select?.questionBankItem?.select, {
    imageUrls: true,
    board: true,
    examName: true,
    examYear: true,
    sourceUrl: true,
  });
  assert.equal(result.total, 1);
  assert.equal(result.stats.attemptsCount, 1);
});
