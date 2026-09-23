import type { TeacherPracticePreviewRepository } from '../repositories/teacher-practice-preview.repository.js';

export type TeacherPracticePreviewQuestionInput = {
  monitorId?: string;
  subjectId?: string;
  topicId?: string;
  page: number;
  pageSize: number;
};

export type TeacherPracticePreviewAnswerInput = {
  questionId: string;
  selectedAnswer: string;
};

export type TeacherPracticePreviewFlashcardFilters = {
  monitorId?: string;
  subjectId?: string;
  topicId?: string;
  excludeFlashcardId?: string;
};

export type TeacherPracticePreviewFlashcard = {
  id: string;
  monitorId: string;
  subjectId: string | null;
  topicId: string | null;
  subject: { id: string; name: string } | null;
  topic: { id: string; name: string } | null;
  monitor: { id: string; name: string } | null;
  front: string;
  back: string;
};

export type TeacherPracticePreviewListResult = {
  questions: unknown[];
  total: number;
  stats: {
    attemptsCount: number;
    correctCount: number;
    answeredQuestionsCount: number;
    accuracy: number;
  };
};

export class TeacherPracticePreviewService {
  constructor(private readonly repository: TeacherPracticePreviewRepository) {}

  async listQuestions(userId: string, input: TeacherPracticePreviewQuestionInput): Promise<TeacherPracticePreviewListResult> {
    return this.repository.findOwnedApprovedQuestions(userId, input);
  }

  async answer(userId: string, input: TeacherPracticePreviewAnswerInput) {
    const question = await this.repository.findOwnedApprovedQuestion(userId, input.questionId);
    if (!question) throw new Error('QUESTION_NOT_ACCESSIBLE');

    const selectedAnswer = input.selectedAnswer.trim().toUpperCase();
    const correctAnswer = question.correctAnswer?.trim().toUpperCase() ?? null;

    return {
      isCorrect: Boolean(correctAnswer && selectedAnswer === correctAnswer),
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
    };
  }

  async getRandomFlashcard(userId: string, filters: TeacherPracticePreviewFlashcardFilters) {
    const cards = await this.repository.findOwnedApprovedFlashcards(userId, filters);
    const available = cards.filter((card) => card.id !== filters.excludeFlashcardId);
    const card = available[Math.floor(Math.random() * available.length)];
    if (!card) throw new Error('NO_FLASHCARDS_FOUND');
    return { ...card, cardStatus: 'PREVIEW' as const };
  }

  async reviewFlashcard(userId: string, flashcardId: string, rating: 'AGAIN' | 'HARD' | 'GOOD' | 'EASY') {
    const flashcard = await this.repository.findOwnedApprovedFlashcard(userId, { flashcardId });
    if (!flashcard) throw new Error('FLASHCARD_NOT_ACCESSIBLE');
    return { flashcardId: flashcard.id, rating, preview: true as const };
  }
}
