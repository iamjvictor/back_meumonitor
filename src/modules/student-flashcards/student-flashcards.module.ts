import { StudentFlashcardsController } from './student-flashcards.controller.js';
import { PrismaStudentFlashcardsRepository } from './student-flashcards.repository.js';
import { createStudentFlashcardsService, type FlashcardAccess, type FlashcardRepository } from './student-flashcards.service.js';

export function createStudentFlashcardsModule(input: {
  access: FlashcardAccess;
  repository?: FlashcardRepository;
}) {
  const repository = input.repository ?? new PrismaStudentFlashcardsRepository();
  const service = createStudentFlashcardsService({ access: input.access, repository });
  const controller = new StudentFlashcardsController(service);
  return { repository, service, controller };
}
