import assert from 'node:assert/strict';
import test from 'node:test';
import { pickRandomAvailable } from '../flashcard-selection.js';

test('never returns the excluded flashcard when another card is available', () => {
  const cards = [{ id: 'current' }, { id: 'next' }];

  const selected = pickRandomAvailable(cards, 'current', () => 0);

  assert.equal(selected?.id, 'next');
});

test('chooses different positions according to the random value', () => {
  const cards = [{ id: 'first' }, { id: 'second' }, { id: 'third' }];

  assert.equal(pickRandomAvailable(cards, undefined, () => 0)?.id, 'first');
  assert.equal(pickRandomAvailable(cards, undefined, () => 0.99)?.id, 'third');
});
