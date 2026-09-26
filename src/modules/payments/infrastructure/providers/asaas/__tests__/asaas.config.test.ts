import assert from 'node:assert/strict';
import test from 'node:test';
import { selectAsaasApiKey } from '../asaas.config.js';

test('seleciona a chave Sandbox quando ASAAS_ENV é sandbox', () => {
  assert.equal(
    selectAsaasApiKey('sandbox', { sandbox: 'sandbox-key', production: 'production-key' }),
    'sandbox-key',
  );
});

test('seleciona a chave de produção quando ASAAS_ENV é production', () => {
  assert.equal(
    selectAsaasApiKey('production', { sandbox: 'sandbox-key', production: 'production-key' }),
    'production-key',
  );
});
