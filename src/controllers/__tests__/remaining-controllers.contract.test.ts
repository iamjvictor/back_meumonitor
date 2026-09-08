import test from 'node:test';
import assert from 'node:assert/strict';
import { teacherProfileBodySchema } from '../teacher.controller.js';
import { addSubjectBodySchema, addTopicBodySchema } from '../monitor.controller.js';

test('teacher profile schema rejects unknown HTTP fields', () => {
  const result = teacherProfileBodySchema.safeParse({ username: 'ana', unexpected: true });
  assert.equal(result.success, false);
});

test('monitor subject and topic schemas reject unknown HTTP fields', () => {
  assert.equal(addSubjectBodySchema.safeParse({ name: 'Mat', topics: ['A'], extra: true }).success, false);
  assert.equal(addTopicBodySchema.safeParse({ name: 'Topico', extra: true }).success, false);
});
