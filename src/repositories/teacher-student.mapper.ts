type TeacherStudentSubscriptionInput = {
  student: { id: string; fullName: string; email: string; avatarUrl: string | null };
  monitor: { id: string; name: string; priceCents: number };
  status: string;
  startsAt: Date;
  endsAt: Date | null;
  subscriptionItem: { finalAmount: number; status: string; currentPeriodEnd: Date | null; subscription: { status: string; billingInterval: string; currentPeriodEnd: Date } } | null;
  paymentSubscriptionItem: { status: string; priceCentsSnapshot: number; subscription: { status: string; currentPeriodEnd: Date | null; nextDueDate: Date | null } } | null;
};

export type TeacherStudentSubscription = {
  studentId: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  monitorId: string;
  monitorName: string;
  status: string;
  priceCents: number;
  startsAt: Date;
  currentPeriodEnd: Date | null;
  nextDueDate: Date | null;
};

export function mapTeacherStudentSubscription(input: TeacherStudentSubscriptionInput): TeacherStudentSubscription {
  const payment = input.paymentSubscriptionItem;
  const legacy = input.subscriptionItem;
  return {
    studentId: input.student.id,
    fullName: input.student.fullName,
    email: input.student.email,
    avatarUrl: input.student.avatarUrl,
    monitorId: input.monitor.id,
    monitorName: input.monitor.name,
    status: payment?.status ?? legacy?.status ?? input.status,
    priceCents: payment?.priceCentsSnapshot ?? legacy?.finalAmount ?? input.monitor.priceCents,
    startsAt: input.startsAt,
    currentPeriodEnd: payment?.subscription.currentPeriodEnd ?? legacy?.currentPeriodEnd ?? input.endsAt,
    nextDueDate: payment?.subscription.nextDueDate ?? legacy?.subscription.currentPeriodEnd ?? null,
  };
}
