export const WEEKLY_SIMULATION_TIMEZONE = 'America/Sao_Paulo';

export type WeeklySimulationCycle = {
  cycleStartDate: string;
  cycleStart: Date;
  analysisEnd: Date;
};

export type WeeklySimulationState =
  | 'AVAILABLE_TO_GENERATE'
  | 'PENDING'
  | 'PROCESSING'
  | 'READY'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'BLOCKED_BY_PREVIOUS'
  | 'FAILED';

type SimulationReference = { id: string; status: Exclude<WeeklySimulationState, 'AVAILABLE_TO_GENERATE' | 'BLOCKED_BY_PREVIOUS'> };

function formatLocalDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: WEEKLY_SIMULATION_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftLocalDate(date: string, days: number): string {
  const shifted = new Date(`${date}T12:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function localReleaseAt(date: string): Date {
  return new Date(`${date}T23:59:00.000-03:00`);
}

export function getWeeklySimulationCycle(now = new Date()): WeeklySimulationCycle {
  const localDate = formatLocalDate(now);
  const localWeekday = new Date(`${localDate}T12:00:00.000Z`).getUTCDay();
  const daysSinceFriday = (localWeekday + 2) % 7;
  const candidateCycleStartDate = shiftLocalDate(localDate, -daysSinceFriday);
  const candidateCycleStart = localReleaseAt(candidateCycleStartDate);
  const cycleStartDate = now >= candidateCycleStart
    ? candidateCycleStartDate
    : shiftLocalDate(candidateCycleStartDate, -7);
  const cycleStart = localReleaseAt(cycleStartDate);

  return { cycleStartDate, cycleStart, analysisEnd: now };
}

export function getWeeklySimulationState(input: {
  current: SimulationReference | null;
  previousIncomplete: SimulationReference | null;
}): WeeklySimulationState {
  if (input.current) return input.current.status;
  if (input.previousIncomplete) return 'BLOCKED_BY_PREVIOUS';
  return 'AVAILABLE_TO_GENERATE';
}
