import assert from 'node:assert/strict';
import test from 'node:test';
import { TeacherPracticePreviewService } from '../teacher-practice-preview.service.js';

test('lista questões aprovadas do monitor do professor sem procurar Student', async () => {
  const repository = {
    findOwnedApprovedQuestions: async () => ({
      questions: [{ id: 'question-1' }],
      total: 1,
      stats: { attemptsCount: 0, correctCount: 0, answeredQuestionsCount: 0, accuracy: 0 },
    }),
    findOwnedApprovedQuestion: async () => ({
      id: 'question-1',
      monitorId: 'monitor-1',
      correctAnswer: 'B',
      explanation: 'Explicação',
    }),
  };
  const service = new TeacherPracticePreviewService(repository as never);

  const result = await service.listQuestions('teacher-user-1', { monitorId: 'monitor-1', page: 1, pageSize: 20 });
  assert.equal(result.total, 1);
  assert.equal(result.stats.attemptsCount, 0);
});

test('responde questão no preview sem persistir tentativa de aluno', async () => {
  let persisted = false;
  const repository = {
    findOwnedApprovedQuestions: async () => ({ questions: [], total: 0, stats: { attemptsCount: 0, correctCount: 0, answeredQuestionsCount: 0, accuracy: 0 } }),
    findOwnedApprovedQuestion: async () => ({ id: 'question-1', monitorId: 'monitor-1', correctAnswer: 'B', explanation: 'Explicação' }),
    createPracticeAttempt: async () => { persisted = true; },
  };
  const service = new TeacherPracticePreviewService(repository as never);

  const result = await service.answer('teacher-user-1', { questionId: 'question-1', selectedAnswer: 'b' });
  assert.equal(result.isCorrect, true);
  assert.equal(result.correctAnswer, 'B');
  assert.equal(persisted, false);
});

test('busca flashcard aprovado do monitor do professor sem exigir Student', async () => {
  const repository = {
    findOwnedApprovedQuestions: async () => ({ questions: [], total: 0, stats: { attemptsCount: 0, correctCount: 0, answeredQuestionsCount: 0, accuracy: 0 } }),
    findOwnedApprovedQuestion: async () => null,
    findOwnedApprovedFlashcards: async () => [{
      id: 'flashcard-1',
      monitorId: 'monitor-1',
      subjectId: 'subject-1',
      topicId: 'topic-1',
      subject: { id: 'subject-1', name: 'Matemática' },
      topic: { id: 'topic-1', name: 'Álgebra' },
      monitor: { id: 'monitor-1', name: 'Monitor teste' },
      front: 'Pergunta',
      back: 'Resposta',
    }],
  };
  const service = new TeacherPracticePreviewService(repository as never);

  const result = await service.getRandomFlashcard('teacher-user-1', { monitorId: 'monitor-1' });
  assert.equal(result.id, 'flashcard-1');
  assert.equal(result.cardStatus, 'PREVIEW');
});

test('avalia flashcard no preview sem persistir revisão SRS', async () => {
  const repository = {
    findOwnedApprovedQuestions: async () => ({ questions: [], total: 0, stats: { attemptsCount: 0, correctCount: 0, answeredQuestionsCount: 0, accuracy: 0 } }),
    findOwnedApprovedQuestion: async () => null,
    findOwnedApprovedFlashcards: async () => [],
    findOwnedApprovedFlashcard: async () => ({ id: 'flashcard-1', monitorId: 'monitor-1' }),
  };
  const service = new TeacherPracticePreviewService(repository as never);

  const result = await service.reviewFlashcard('teacher-user-1', 'flashcard-1', 'GOOD');
  assert.deepEqual(result, { flashcardId: 'flashcard-1', rating: 'GOOD', preview: true });
});
