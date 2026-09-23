import assert from 'node:assert/strict';
import test from 'node:test';

import { TextNormalizationService } from '../text-normalization.service.js';

test('remove caracteres NUL que o PostgreSQL não aceita em conteúdo extraído', () => {
  const result = new TextNormalizationService().normalize('Antes\u0000Depois');

  assert.equal(result.normalizedContent, 'AntesDepois');
});
