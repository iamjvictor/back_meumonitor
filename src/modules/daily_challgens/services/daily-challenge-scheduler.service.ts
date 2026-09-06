import { DailyChallengeGenerationService } from './daily-challenge-generation.service.js';
import { getSaoPauloChallengeWindow, SAO_PAULO_TIMEZONE } from './daily-challenge-selection.service.js';

function log(event: string, data: Record<string, unknown> = {}) { console.log(event, { event, ...data }); }

export function nextSaoPauloMidnight(now = new Date()): Date {
  const current = getSaoPauloChallengeWindow(now);
  const next = new Date(current.availableFrom.getTime() + 24 * 60 * 60 * 1000);
  return next;
}

export function startDailyChallengeScheduler(
  generate: () => Promise<unknown> = () => new DailyChallengeGenerationService().generateForDate(),
  timer: typeof setTimeout = setTimeout,
) {
  let stopped = false;
  let timerHandle: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (stopped) return;
    const nextRun = nextSaoPauloMidnight();
    const delay = Math.max(1, nextRun.getTime() - Date.now());
    log('monitor.daily_challenge_scheduler_scheduled', { timezone: SAO_PAULO_TIMEZONE, nextRun, delayMs: delay });
    timerHandle = timer(() => {
      void generate()
        .catch((error) => log('monitor.daily_challenge_generation_failed', { errorCode: error instanceof Error ? error.message : 'UNKNOWN_ERROR' }))
        .finally(schedule);
    }, delay);
  };
  schedule();
  return { stop() { stopped = true; if (timerHandle) clearTimeout(timerHandle); log('monitor.daily_challenge_scheduler_stopped', { timezone: SAO_PAULO_TIMEZONE }); } };
}
