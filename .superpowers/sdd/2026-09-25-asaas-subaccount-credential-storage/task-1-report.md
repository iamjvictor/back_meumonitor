# Task 1 — Criptografia e contrato do cofre local

## Status

Concluída.

## Implementação

- `PaymentAccountCredentialCrypto` com AES-256-GCM, nonce aleatório de 12 bytes, auth tag e `keyVersion: 1`.
- Chave mestra lida de `PAYMENT_ACCOUNT_CREDENTIAL_MASTER_KEY` em base64 e validada para exatamente 32 bytes.
- AAD vincula o ciphertext ao `accountId` e ao ambiente (`SANDBOX`/`PRODUCTION`), impedindo reuso cruzado.
- `LocalPaymentAccountCredentialStore` implementa o contrato `PaymentAccountCredentialStore` e delega à camada crypto.
- Logs opcionais carregam apenas metadados; plaintext não é incluído no objeto persistível nem em logs.

## TDD

- RED: teste executado antes da implementação; falhou por módulo crypto ausente (`ERR_MODULE_NOT_FOUND`).
- GREEN: implementação adicionada e todos os testes do arquivo passaram.

## Verificação

- `node --import tsx --test src/modules/payments/__tests__/payment-account-credential.crypto.test.ts` — 5 testes, 5 passaram.
- `npm run typecheck` — passou.

## Preocupações

- O nome da variável de ambiente adotado é `PAYMENT_ACCOUNT_CREDENTIAL_MASTER_KEY`; deve ser incluído na configuração/deploy da próxima task.
- Não foi executada a suíte completa do backend porque não existe script `test` geral no `package.json`; a verificação ficou focada no teste da task e no typecheck.
