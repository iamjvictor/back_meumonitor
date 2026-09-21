import { StudentQuestionAttemptRepository } from '../repositories/student-question-attempt.repository.js';
import { calculateQuestionCorrectness, type ResetStudentQuestionAttemptsInput, type StudentQuestionAttemptInput } from '../models/student-question-attempt.model.js';

function log(event: string, data: Record<string, unknown> = {}) { console.log(event, { event, ...data }); }

export class StudentQuestionAttemptService {
  constructor(private readonly repository = new StudentQuestionAttemptRepository()) {}

  async listQuestions(userId: string, input: { monitorId?: string; subjectId?: string; topicId?: string; page: number; pageSize: number }) {
    const student = await this.repository.findStudentByUserId(userId);
    if (!student) throw new Error('STUDENT_NOT_FOUND');
    const monitorIds = await this.repository.findAccessibleMonitorIds(student.id, userId);
    if (input.monitorId && !monitorIds.includes(input.monitorId)) throw new Error('MONITOR_NOT_ACCESSIBLE');
    return this.repository.listApprovedQuestions({ ...input, studentId: student.id, monitorIds });
  }

  async answer(userId: string, input: StudentQuestionAttemptInput) {
    log('monitor.student_question_attempt_service_started', { userId, questionId: input.questionId, mode: input.mode, hasIdempotencyKey: Boolean(input.idempotencyKey) });
    const student = await this.repository.findStudentByUserId(userId);
    if (!student) {
      log('monitor.student_question_attempt_student_not_found', { userId, questionId: input.questionId });
      throw new Error('STUDENT_NOT_FOUND');
    }
    const monitorIds = await this.repository.findAccessibleMonitorIds(student.id, userId);
    log('monitor.student_question_attempt_access_resolved', { userId, studentId: student.id, questionId: input.questionId, accessibleMonitorCount: monitorIds.length });
    const question = await this.repository.findApprovedQuestion(input.questionId, monitorIds);
    if (!question) {
      log('monitor.student_question_attempt_question_not_accessible', { userId, studentId: student.id, questionId: input.questionId });
      throw new Error('QUESTION_NOT_ACCESSIBLE');
    }
    const attempt = await this.repository.createPracticeAttempt({ studentId: student.id, question, data: input });
    log('monitor.student_question_attempt_persisted', { userId, studentId: student.id, questionId: question.id, monitorId: question.monitorId, questionAttemptId: attempt.id, isCorrect: attempt.isCorrect, mode: attempt.mode });
    return {
      attempt,
      isCorrect: calculateQuestionCorrectness(input.selectedAnswer, question.correctAnswer),
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
    };
  }

  async reset(userId: string, input: ResetStudentQuestionAttemptsInput) {
    const student = await this.repository.findStudentByUserId(userId);
    if (!student) throw new Error('STUDENT_NOT_FOUND');

    const monitorIds = await this.repository.findAccessibleMonitorIds(student.id, userId);
    if (input.monitorId && !monitorIds.includes(input.monitorId)) throw new Error('MONITOR_NOT_ACCESSIBLE');

    const archivedCount = await this.repository.archiveActiveAttempts({
      studentId: student.id,
      monitorIds,
      ...input,
    });

    return { archivedCount };
  }
}
