# Task 3 — Captura e persistência da credencial Asaas

Status: concluída.

## Implementado

- `AsaasAccountProvider` captura `apiKey` somente no resultado transitório interno.
- A propriedade é não enumerável e não aparece nos logs nem na resposta pública.
- `PaymentAccountRepository` recebe `PaymentAccountCredentialStore`, cifra a chave usando o ID da conta recém-criada e persiste `PaymentAccountCredential` na mesma transação que a conta, perfil e vínculo do professor.
- Ausência da chave ou falha de cifra/persistência interrompe a transação antes de atualizar `current_payment_account_id`.
- Teste cobre transporte transitório e ausência de segredo no resultado público.

## Verificações

- `node --import tsx --test src/modules/payments/__tests__/asaas-account.provider.test.ts src/modules/payments/__tests__/start-payment-account-credential.test.ts src/modules/payments/__tests__/payment-account-credential.crypto.test.ts` — passou (3 testes).
- `npm run typecheck -- --pretty false` — passou.

## Commit

Será criado no branch de Task 3 após esta verificação.

## Preocupações

- A transação depende do comportamento transacional do Prisma para reverter a conta se a cifra ou a criação da credencial falhar.
- A API do Asaas pode não retornar `apiKey` em respostas futuras; nesse caso a operação falha fechadamente e não cria vínculo local incompleto.
