import { createHash } from 'node:crypto';

/** Canonical representation used by every flashcard front hash path. */
export function normalizeFlashcardFront(front: string): string {
  return front.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
}

export function computeFlashcardFrontHash(front: string): string {
  return createHash('sha256').update(normalizeFlashcardFront(front)).digest('hex');
}
