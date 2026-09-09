import { PrismaStudentAccessRepository } from './student-access.repository.js';
import { StudentAccessController } from './student-access.controller.js';
import { createStudentAccessService, type StudentAccessRepository } from './student-access.service.js';

export function createStudentAccessModule(input: { repository?: StudentAccessRepository } = {}) {
  const repository = input.repository ?? new PrismaStudentAccessRepository();
  const service = createStudentAccessService(repository);
  const controller = new StudentAccessController(service);
  return { repository, service, controller };
}
