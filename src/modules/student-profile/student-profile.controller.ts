import type { StudentProfileInput, StudentProfileUser } from './student-profile.service.js';
import { createStudentProfileService } from './student-profile.service.js';

export class StudentProfileController {
  constructor(private readonly service: ReturnType<typeof createStudentProfileService>) {}

  async updateProfile(user: StudentProfileUser, profile: StudentProfileInput) {
    return this.service.updateProfile({ user, profile });
  }
}
