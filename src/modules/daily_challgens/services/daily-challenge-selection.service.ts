const SAO_PAULO_TIMEZONE = 'America/Sao_Paulo';

export function selectRandomUnusedQuestion<T>(questions: T[], random: () => number = Math.random): T | null {
  if (questions.length === 0) return null;
  const index = Math.min(questions.length - 1, Math.floor(random() * questions.length));
  return questions[index] ?? null;
}

function formatLocalDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SAO_PAULO_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getSaoPauloChallengeWindow(now: Date): {
  challengeDate: string;
  availableFrom: Date;
  availableUntil: Date;
} {
  const challengeDate = formatLocalDate(now);
  const startUtc = new Date(`${challengeDate}T00:00:00.000-03:00`);
  const nextDate = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return {
    challengeDate,
    availableFrom: startUtc,
    availableUntil: new Date(nextDate.getTime() - 1),
  };
}

export { SAO_PAULO_TIMEZONE };
