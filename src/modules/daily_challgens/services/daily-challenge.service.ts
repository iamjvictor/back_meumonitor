import { DailyChallengeRepository } from '../repositories/daily-challenge.repository.js';
import { getSaoPauloChallengeWindow, SAO_PAULO_TIMEZONE } from './daily-challenge-selection.service.js';
import type { AnswerChallengeInput } from '../models/daily-challenge.model.js';

function log(event: string, data: Record<string, unknown> = {}) { console.log(event, { event, ...data }); }

export class DailyChallengeService {
  constructor(private readonly repository = new DailyChallengeRepository()) {}

  private async resolveAccess(userId: string, monitorId: string) {
    const student = await this.repository.findStudentByUserId(userId);
    if (!student) throw new Error('STUDENT_NOT_FOUND');
    const enrollment = await this.repository.findActiveEnrollment(student.id, monitorId);
    if (!enrollment) throw new Error('ENROLLMENT_REQUIRED');
    return student;
  }

  async getCurrent(userId: string, monitorId: string, now = new Date()) {
    log('monitor.daily_challenge_http_get_started', { userId, monitorId });
    const student = await this.resolveAccess(userId, monitorId);
    const window = getSaoPauloChallengeWindow(now);
    log('monitor.daily_challenge_access_validated', { userId, studentId: student.id, monitorId, challengeDate: window.challengeDate, timezone: SAO_PAULO_TIMEZONE });
    const challenge = await this.repository.findCurrentForStudent(monitorId, window.challengeDate, student.id);
    if (!challenge) throw new Error('CHALLENGE_NOT_FOUND');
    if (now < challenge.availableFrom || now > challenge.availableUntil) throw new Error('CHALLENGE_EXPIRED');
    const attempt = challenge.attempts[0];
    log('monitor.daily_challenge_loaded', { userId, studentId: student.id, monitorId, challengeId: challenge.id, answered: Boolean(attempt) });
    return {
      id: challenge.id,
      monitorId: challenge.monitorId,
      challengeDate: window.challengeDate,
      availableUntil: challenge.availableUntil,
      answered: Boolean(attempt),
      result: attempt ? { isCorrect: attempt.isCorrect, answeredAt: attempt.answeredAt } : null,
      question: {
        id: challenge.question.id,
        text: challenge.question.text,
        alternatives: challenge.question.alternatives,
        kind: challenge.question.kind,
        difficulty: challenge.question.difficulty,
        subject: challenge.question.subject ? { id: challenge.question.subject.id, name: challenge.question.subject.name } : null,
        topic: challenge.question.topic ? { id: challenge.question.topic.id, name: challenge.question.topic.name } : null,
      },
    };
  }

  async getCurrentForStudent(userId: string, now = new Date()) {
    log('monitor.daily_challenge_http_batch_get_started', { userId });
    const student = await this.repository.findStudentByUserId(userId);
    if (!student) throw new Error('STUDENT_NOT_FOUND');
    const monitorIds = await this.repository.findActiveEnrollmentMonitorIds(student.id);
    if (monitorIds.length === 0) return [];
    const window = getSaoPauloChallengeWindow(now);
    const challenges = await this.repository.findCurrentForStudentMonitors(monitorIds, window.challengeDate, student.id);
    const pending = challenges.filter((challenge) => now >= challenge.availableFrom && now <= challenge.availableUntil && challenge.attempts.length === 0);
    log('monitor.daily_challenge_batch_loaded', { userId, studentId: student.id, enrolledMonitorCount: monitorIds.length, challengeCount: challenges.length, pendingCount: pending.length, challengeDate: window.challengeDate });
    return pending.map((challenge) => ({
      id: challenge.id,
      monitorId: challenge.monitorId,
      challengeDate: window.challengeDate,
      availableUntil: challenge.availableUntil,
      answered: false,
      question: {
        id: challenge.question.id,
        text: challenge.question.text,
        alternatives: challenge.question.alternatives,
        kind: challenge.question.kind,
        difficulty: challenge.question.difficulty,
        subject: challenge.question.subject ? { id: challenge.question.subject.id, name: challenge.question.subject.name } : null,
        topic: challenge.question.topic ? { id: challenge.question.topic.id, name: challenge.question.topic.name } : null,
      },
    }));
  }

  async answer(userId: string, challengeId: string, input: AnswerChallengeInput, now = new Date()) {
    log('monitor.daily_challenge_http_answer_started', { userId, challengeId });
    const challenge = await this.repository.getChallengeForAnswer(challengeId);
    if (!challenge) throw new Error('CHALLENGE_NOT_FOUND');
    const student = await this.resolveAccess(userId, challenge.monitorId);
    if (now < challenge.availableFrom || now > challenge.availableUntil) throw new Error('CHALLENGE_EXPIRED');
    log('monitor.daily_challenge_answer_validated', { userId, studentId: student.id, challengeId, monitorId: challenge.monitorId });
    const result = await this.repository.answerChallenge({ studentId: student.id, challengeId, ...input, answeredAt: now });
    if (result.alreadyAnswered) {
      log('monitor.daily_challenge_already_answered', { userId, studentId: student.id, challengeId });
      return { alreadyAnswered: true, isCorrect: result.attempt.isCorrect, correctAnswer: result.challenge.question.correctAnswer, questionAttemptId: result.attempt.questionAttemptId, explanation: result.challenge.question.explanation };
    }
    log('monitor.daily_challenge_question_attempt_created', { userId, studentId: student.id, challengeId, questionAttemptId: result.attempt.questionAttemptId });
    log('monitor.daily_challenge_attempt_created', { userId, studentId: student.id, challengeId, isCorrect: result.attempt.isCorrect });
    log('monitor.daily_challenge_performance_updated', { userId, studentId: student.id, challengeId, mode: 'DAILY_CHALLENGE' });
    return { alreadyAnswered: false, isCorrect: result.attempt.isCorrect, correctAnswer: result.challenge.question.correctAnswer, questionAttemptId: result.attempt.questionAttemptId, explanation: result.challenge.question.explanation };
  }
}
