import { DailyChallengeRepository } from '../repositories/daily-challenge.repository.js';
import { DAILY_CHALLENGE_SELECTION_STRATEGY } from '../models/daily-challenge.model.js';
import { getSaoPauloChallengeWindow, selectRandomUnusedQuestion, SAO_PAULO_TIMEZONE } from './daily-challenge-selection.service.js';

function log(event: string, data: Record<string, unknown> = {}) { console.log(event, { event, ...data }); }

export class DailyChallengeGenerationService {
  constructor(private readonly repository = new DailyChallengeRepository()) {}

  async generateForDate(now = new Date()) {
    const startedAt = Date.now();
    const window = getSaoPauloChallengeWindow(now);
    const jobKey = `daily-challenge-generation:${window.challengeDate}`;
    log('monitor.daily_challenge_generation_started', { challengeDate: window.challengeDate, timezone: SAO_PAULO_TIMEZONE, jobKey });
    const monitors = await this.repository.findEligibleMonitors();
    log('monitor.daily_challenge_monitors_loaded', { challengeDate: window.challengeDate, monitorCount: monitors.length, jobKey });
    let created = 0; let existing = 0; let unavailable = 0;
    for (const monitor of monitors) {
      try {
        const current = await this.repository.findByMonitorAndDate(monitor.id, window.challengeDate);
        if (current) { existing += 1; log('monitor.daily_challenge_already_exists', { monitorId: monitor.id, challengeDate: window.challengeDate, challengeId: current.id, jobKey }); continue; }
        const candidates = await this.repository.findApprovedUnusedQuestions(monitor.id);
        log('monitor.daily_challenge_selection_started', { monitorId: monitor.id, challengeDate: window.challengeDate, eligibleQuestionCount: candidates.length, selectionStrategy: DAILY_CHALLENGE_SELECTION_STRATEGY, jobKey });
        const question = selectRandomUnusedQuestion(candidates);
        if (!question) { unavailable += 1; log('monitor.daily_challenge_no_eligible_question', { monitorId: monitor.id, challengeDate: window.challengeDate, errorCode: 'NO_ELIGIBLE_QUESTION', jobKey }); continue; }
        const challenge = await this.repository.createChallenge({
          monitor: { connect: { id: monitor.id } }, question: { connect: { id: question.id } },
          challengeDate: new Date(`${window.challengeDate}T00:00:00.000Z`), availableFrom: window.availableFrom,
          availableUntil: window.availableUntil, selectionStrategy: DAILY_CHALLENGE_SELECTION_STRATEGY,
        });
        created += 1;
        log('monitor.daily_challenge_created', { monitorId: monitor.id, questionId: question.id, challengeId: challenge.id, challengeDate: window.challengeDate, jobKey });
      } catch (error) {
        log('monitor.daily_challenge_generation_failed', { monitorId: monitor.id, challengeDate: window.challengeDate, jobKey, errorCode: error instanceof Error ? error.message : 'UNKNOWN_ERROR' });
      }
    }
    const summary = { challengeDate: window.challengeDate, created, existing, unavailable, durationMs: Date.now() - startedAt };
    log('monitor.daily_challenge_generation_completed', { ...summary, jobKey });
    return summary;
  }
}
