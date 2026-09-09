export interface StudentAccessRepository {
  findStudentByUserId(userId: string): Promise<{ id: string } | null>;
  hasActiveSubscription(studentId: string, monitorId: string): Promise<boolean>;
  hasActiveEnrollment(studentId: string, monitorId: string): Promise<boolean>;
  ownsMonitor(userId: string, monitorId: string): Promise<boolean>;
  cancelSubscription(studentId: string, monitorId: string): Promise<void>;
  cancelEnrollment(studentId: string, monitorId: string): Promise<void>;
  listSubscribedMonitorIds?(studentId: string): Promise<string[]>;
  listEnrolledMonitorIds?(studentId: string): Promise<string[]>;
  listOwnedMonitorIds?(userId: string): Promise<string[]>;
}

export class StudentNotFoundError extends Error {
  readonly code = 'STUDENT_NOT_FOUND';

  constructor() {
    super('Estudante não encontrado.');
  }
}

export class StudentAccessDeniedError extends Error {
  readonly code = 'MONITOR_NOT_ACCESSIBLE';

  constructor() {
    super('Você não possui acesso a este monitor de estudos.');
  }
}

export function createStudentAccessService(repository: StudentAccessRepository) {
  async function getStudent(userId: string) {
    const student = await repository.findStudentByUserId(userId);
    if (!student) throw new StudentNotFoundError();
    return student;
  }

  return {
    async assertMonitorAccess(input: { userId: string; monitorId: string }) {
      const student = await getStudent(input.userId);
      const [subscription, enrollment, owner] = await Promise.all([
        repository.hasActiveSubscription(student.id, input.monitorId),
        repository.hasActiveEnrollment(student.id, input.monitorId),
        repository.ownsMonitor(input.userId, input.monitorId),
      ]);

      if (!subscription && !enrollment && !owner) throw new StudentAccessDeniedError();
      return { studentId: student.id };
    },

    async cancelMonitorAccess(input: { userId: string; monitorId: string }) {
      const student = await getStudent(input.userId);
      await Promise.all([
        repository.cancelSubscription(student.id, input.monitorId),
        repository.cancelEnrollment(student.id, input.monitorId),
      ]);
    },

    async getAccessibleMonitorIds(input: { userId: string }) {
      const student = await getStudent(input.userId);
      const [subscriptions, enrollments, owned] = await Promise.all([
        repository.listSubscribedMonitorIds?.(student.id) ?? [],
        repository.listEnrolledMonitorIds?.(student.id) ?? [],
        repository.listOwnedMonitorIds?.(input.userId) ?? [],
      ]);
      return { studentId: student.id, monitorIds: Array.from(new Set([...subscriptions, ...enrollments, ...owned])) };
    },
  };
}
