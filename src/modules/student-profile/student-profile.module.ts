import { StudentProfileController } from './student-profile.controller.js';
import { PrismaStudentProfileRepository } from './student-profile.repository.js';
import {
  createStudentProfileService,
  type StudentProfileRepository,
} from './student-profile.service.js';

export function createStudentProfileModule(input: { repository?: StudentProfileRepository } = {}) {
  const repository = input.repository ?? new PrismaStudentProfileRepository();
  const service = createStudentProfileService(repository);
  const controller = new StudentProfileController(service);

  return { repository, service, controller };
}
