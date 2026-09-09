export function pickRandomAvailable<T>(
  cards: T[],
  excludedId: string | undefined,
  random: () => number = Math.random,
  getId: (card: T) => string = (card) => (card as { id: string }).id,
): T | null {
  const available = excludedId
    ? cards.filter((card) => getId(card) !== excludedId)
    : cards;

  if (available.length === 0) return null;

  const index = Math.min(available.length - 1, Math.floor(random() * available.length));
  return available[index] ?? null;
}
