# Sincronização de status das subcontas Asaas

## Objetivo

Manter o painel do professor consistente com a aprovação da subconta no Asaas. O Asaas é a fonte de verdade; o banco local mantém um espelho operacional, atualizado exclusivamente por eventos autenticados ou por uma reconciliação explícita.

## Fluxo de status

1. A plataforma cria a subconta em `POST /accounts`.
2. Com a credencial retornada exclusivamente para aquela subconta, a plataforma lista `GET /webhooks?limit=100` e cria ou atualiza o webhook de status em `/webhooks`.
3. O Asaas envia eventos `ACCOUNT_STATUS_*` ao endpoint `POST /api/v1/payments/webhooks/asaas` com o cabeçalho `asaas-access-token`.
4. O endpoint valida o token e persiste o envelope em `payment_webhook_events` antes de responder `200`.
5. O worker processa a inbox e espelha o evento em `payment_accounts`.

O webhook é idempotente: se já houver uma configuração para a mesma URL da subconta, ela é atualizada; caso contrário, é criada. O ID retornado é salvo em `payment_accounts.provider_webhook_id`.

## Espelho de status no banco

| Tabela | Campos relevantes | Papel na integração |
|---|---|---|
| `teachers` | `current_payment_account_id` | Ponteiro da conta de recebimento ativa do professor. Não é uma cópia do estado Asaas. |
| `payment_accounts` | `environment`, `provider`, `provider_account_id`, `wallet_id`, `provider_webhook_id` | Identidade local da subconta e do webhook por ambiente. `provider_account_id` deve corresponder ao `account.id` recebido no evento. |
| `payment_accounts` | `status`, `general_status`, `commercial_info_status`, `bank_account_status`, `documentation_status` | Espelho de elegibilidade e das quatro dimensões de análise do Asaas. |
| `payment_accounts` | `verified_at`, `last_event_at`, `rejection_reason`, `onboarding_url`, `activation_channel` | Metadados locais de ativação e auditoria de tempo. `verified_at` só é preenchido pela aprovação geral. |
| `payment_account_credentials` | `payment_account_id`, `environment`, `ciphertext`, `nonce`, `auth_tag`, `key_version` | Credencial cifrada da subconta. É usada no backend para listar/criar/atualizar o webhook e consultar indicadores. Nunca expor ou registrar em logs. |
| `teacher_payment_profiles` | `payment_account_id` e dados cadastrais | Snapshot dos dados KYC enviados na criação. Não é o status de aprovação. Contém PII e não deve ser usado em consultas operacionais de status. |
| `payment_webhook_events` | `environment`, `provider_account_id`, `provider_event_id`, `event_type`, `payload`, `state`, `attempts`, `failure_message`, `processed_at` | Inbox idempotente e trilha de auditoria bruta dos eventos recebidos. É a fonte para reprocessamento local. |
| `payment_outbox_events` | `aggregate_id`, `event_type`, `state`, `attempts`, `processed_at` | Entrega assíncrona para o worker após a persistência da inbox. Não é o espelho do status da conta. |
| `payment_audit_entries` | `origin`, `reason`, `before`, `after`, `teacher_id` | Auditoria de mudanças financeiras quando aplicável; não substitui a inbox. |

## Regras de mapeamento

| Evento Asaas | Campo que muda | `payment_accounts.status` |
|---|---|---|
| `ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED` | `general_status=APPROVED`, `verified_at=ocorrido_em` | `APPROVED` |
| `ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED` | `general_status=REJECTED`, `verified_at=NULL` | `REJECTED` |
| `ACCOUNT_STATUS_GENERAL_APPROVAL_PENDING` ou `...AWAITING_APPROVAL` | `general_status` correspondente, `verified_at=NULL` | `PENDING` |
| `ACCOUNT_STATUS_COMMERCIAL_INFO_*` | `commercial_info_status` | Não muda o status geral |
| `ACCOUNT_STATUS_BANK_ACCOUNT_INFO_*` | `bank_account_status` | Não muda o status geral |
| `ACCOUNT_STATUS_DOCUMENT_*` | `documentation_status` | Não muda o status geral |

Um documento ou conta bancária aprovados isoladamente **não** tornam a subconta elegível. A elegibilidade para criação/publicação é dada somente pela aprovação geral.

## Correção de conta já criada

Para uma conta existente sem `provider_webhook_id`, use o comando administrativo no ambiente correspondente:

```bash
cd backend
npm run asaas:subaccount-webhook:sync -- <paymentAccountId>
```

O comando exige `ASAAS_ENV`, `ASAAS_WEBHOOK_URL` (ou `PUBLIC_API_URL`), `ASAAS_WEBHOOK_EMAIL`, `ASAAS_WEBHOOK_AUTH_TOKEN` e a chave de criptografia local. Ele não aprova a conta nem modifica os campos de status; apenas garante o webhook da subconta e persiste o identificador devolvido pelo Asaas.

Para a conta de produção identificada na investigação atual, o alvo é `4fc5cceb-7a13-4f9e-be20-ceae8e148ce5`.

## Conferência operacional

Depois de corrigir o webhook, verifique a configuração local e o espelho:

```sql
SELECT
  id,
  environment,
  provider_account_id,
  provider_webhook_id,
  status,
  general_status,
  commercial_info_status,
  bank_account_status,
  documentation_status,
  verified_at,
  last_event_at,
  updated_at
FROM payment_accounts
WHERE id = '<paymentAccountId>';
```

Para ver os eventos recebidos e seu processamento:

```sql
SELECT
  id,
  provider_event_id,
  event_type,
  state,
  attempts,
  failure_message,
  created_at,
  processed_at
FROM payment_webhook_events
WHERE environment = 'PRODUCTION'
  AND provider_account_id = '<providerAccountId>'
ORDER BY created_at DESC;
```

## Reprocessamento

O reprocessamento é feito somente para um evento que já esteja na inbox. Não criar um evento manual com aprovação sem antes confirmar o estado no Asaas. Para um evento existente, use:

```bash
cd backend
npm run payments:process-webhook-event -- <paymentWebhookEventId>
```

O processador atualiza o espelho apenas se o `provider_account_id` do evento encontrar a subconta local no mesmo ambiente. O resultado esperado para uma aprovação geral é `ACCOUNT_STATUS_APPLIED`.

## Melhorias recomendadas

1. Monitorar contas `PENDING` há mais de um período definido e alertar quando `provider_webhook_id` estiver vazio.
2. Adicionar uma reconciliação diária, somente leitura no Asaas, que detecte divergência entre o estado remoto e `payment_accounts`; aplicar mudanças via trilha auditável.
3. Incluir `environment` no vínculo/índice único de `provider_account_id`, para evitar colisões entre sandbox e produção.
4. Tornar o worker recuperável também para eventos `WAITING_CORRELATION` quando a conta local for criada após o evento.
5. Registrar métricas para criação/atualização de webhook, recepção, processamento e divergências de status, sem armazenar token, chave ou PII.
