type TeacherSubscriptionRow = {
  id?: string; subscriptionId?: string;
  studentId: string; studentName: string; email: string; monitorId: string; monitorName: string;
  subscriptionStatus: string; itemStatus: string; grossCents: number; teacherPercentageSnapshot: string | number;
  expectedCents: number | null; settledCents: number | null; splitStatus: string; servicePeriodEnd: string | null;
  createdAt?: string | null; updatedAt?: string | null; cancelledAt?: string | null;
};

type Repository = { listForTeacher(teacherId: string): Promise<TeacherSubscriptionRow[]> };

export class TeacherPayoutService {
  constructor(private readonly repository: Repository) {}

  async list(teacherId: string) {
    const rows = await this.repository.listForTeacher(teacherId);
    const items = rows.map((row) => {
      const percentage = Number(row.teacherPercentageSnapshot);
      const expectedTeacherCents = row.expectedCents ?? Math.round(row.grossCents * percentage / 100);
      const settledTeacherCents = row.settledCents ?? 0;
      return {
        id: row.id ?? null,
        subscriptionId: row.subscriptionId ?? null,
        studentId: row.studentId,
        studentName: row.studentName,
        email: row.email,
        monitorId: row.monitorId,
        monitorName: row.monitorName,
        subscriptionStatus: row.subscriptionStatus,
        itemStatus: row.itemStatus,
        grossCents: row.grossCents,
        teacherPercentageSnapshot: percentage,
        expectedTeacherCents,
        settledTeacherCents,
        splitStatus: row.splitStatus,
        servicePeriodEnd: row.servicePeriodEnd,
        createdAt: row.createdAt ?? null,
        updatedAt: row.updatedAt ?? null,
        cancelledAt: row.cancelledAt ?? null,
      };
    });
    const activeItems = items.filter((item) => item.itemStatus === 'ACTIVE' || item.itemStatus === 'CANCEL_PENDING');
    const summary = activeItems.reduce((acc, item) => ({
      grossCents: acc.grossCents + item.grossCents,
      expectedTeacherCents: acc.expectedTeacherCents + item.expectedTeacherCents,
      settledTeacherCents: acc.settledTeacherCents + item.settledTeacherCents,
      pendingTeacherCents: acc.pendingTeacherCents + Math.max(item.expectedTeacherCents - item.settledTeacherCents, 0),
    }), { grossCents: 0, expectedTeacherCents: 0, settledTeacherCents: 0, pendingTeacherCents: 0 });
    return { items, summary };
  }
}
