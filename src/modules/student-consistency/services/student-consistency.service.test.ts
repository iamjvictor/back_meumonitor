import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSevenDayWindow } from './student-consistency.service.js';

test('builds exactly seven calendar days ending today in Sao Paulo', () => {
  const result = buildSevenDayWindow(new Date('2026-09-04T12:00:00.000Z'));

  assert.deepEqual(result.days, [
    '2026-08-29',
    '2026-08-30',
    '2026-08-31',
    '2026-09-01',
    '2026-09-02',
    '2026-09-03',
    '2026-09-04',
  ]);
  assert.equal(result.startDate, '2026-08-29');
  assert.equal(result.endDateExclusive, '2026-09-05');
});
