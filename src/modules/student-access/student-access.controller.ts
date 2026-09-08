import type { createStudentAccessService } from './student-access.service.js';

type StudentAccessService = Pick<ReturnType<typeof createStudentAccessService>, 'cancelMonitorAccess'>;

export class StudentAccessController {
  constructor(private readonly service: StudentAccessService) {}

  async cancelMonitorAccess(input: { userId: string; monitorId: string }) {
    return this.service.cancelMonitorAccess(input);
  }
}
