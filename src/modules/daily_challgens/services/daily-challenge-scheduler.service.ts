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
  const retryDelayMs = 5 * 60 * 1000;
  const runGeneration = (trigger: 'startup' | 'scheduled' | 'retry') => {
    log('monitor.daily_challenge_generation_triggered', { trigger });
    void generate()
      .then((result) => log('monitor.daily_challenge_generation_trigger_completed', { trigger, result }))
      .catch((error) => {
        log('monitor.daily_challenge_generation_failed', { trigger, errorCode: error instanceof Error ? error.message : 'UNKNOWN_ERROR', retryDelayMs });
        if (!stopped) timerHandle = timer(() => runGeneration('retry'), retryDelayMs);
      });
  };
  const schedule = () => {
    if (stopped) return;
    const nextRun = nextSaoPauloMidnight();
    const delay = Math.max(1, nextRun.getTime() - Date.now());
    log('monitor.daily_challenge_scheduler_scheduled', { timezone: SAO_PAULO_TIMEZONE, nextRun, delayMs: delay });
    timerHandle = timer(() => { runGeneration('scheduled'); schedule(); }, delay);
  };
  runGeneration('startup');
  schedule();
  return { stop() { stopped = true; if (timerHandle) clearTimeout(timerHandle); log('monitor.daily_challenge_scheduler_stopped', { timezone: SAO_PAULO_TIMEZONE }); } };
}
