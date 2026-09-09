import type { createStudentFlashcardsService } from './student-flashcards.service.js';

type StudentFlashcardsService = Pick<ReturnType<typeof createStudentFlashcardsService>, 'reviewFlashcard' | 'getRandomFlashcard'>;

export class StudentFlashcardsController {
  constructor(private readonly service: StudentFlashcardsService) {}

  async reviewFlashcard(input: Parameters<StudentFlashcardsService['reviewFlashcard']>[0]) {
    return this.service.reviewFlashcard(input);
  }

  async getRandomFlashcard(input: Parameters<StudentFlashcardsService['getRandomFlashcard']>[0]) {
    return this.service.getRandomFlashcard(input);
  }
}
