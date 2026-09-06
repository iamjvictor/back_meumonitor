import { StudentConsistencyRepository } from '../repositories/student-consistency.repository.js';

const TIME_ZONE = 'America/Sao_Paulo';

function formatDateInSaoPaulo(date: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function addDays(dateKey: string, amount: number) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function buildSevenDayWindow(now = new Date()) {
  const endDate = formatDateInSaoPaulo(now);
  const days = Array.from({ length: 7 }, (_, index) => addDays(endDate, index - 6));
  return { days, startDate: days[0]!, endDateExclusive: addDays(endDate, 1) };
}

export class StudentConsistencyService {
  constructor(private readonly repository = new StudentConsistencyRepository()) {}

  async getForUser(userId: string, now = new Date()) {
    const student = await this.repository.findStudentByUserId(userId);
    if (!student) throw new Error('STUDENT_NOT_FOUND');
    const window = buildSevenDayWindow(now);
    const days = await this.repository.aggregateSevenDays(student.id, window.startDate, window.endDateExclusive);
    return { days, startDate: window.startDate, endDate: window.endDateExclusive, timeZone: TIME_ZONE };
  }
}
