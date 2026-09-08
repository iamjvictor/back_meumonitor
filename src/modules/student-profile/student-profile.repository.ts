import { StudentRepository } from '../../repositories/student.repository.js';
import type {
  StudentProfileRepository,
  StudentProfileUpsertInput,
} from './student-profile.service.js';

export class PrismaStudentProfileRepository implements StudentProfileRepository {
  constructor(private readonly repository = new StudentRepository()) {}

  async upsertStudent(input: StudentProfileUpsertInput) {
    return this.repository.upsertStudent(input);
  }
}
