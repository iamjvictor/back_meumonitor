# Checkout mínimo e cancelamento idempotente

**Data:** 2026-09-26  
**Escopo:** checkout hospedado Asaas e cancelamento de item de assinatura pelo aluno.

## Objetivo

Eliminar a rejeição do Asaas causada pelo checkout recorrente de R$ 0,01 e tornar o cancelamento uma operação única, observável e segura para reenvio depois de falha.

## Checkout

- O override temporário de checkout é R$ 5,00 (`500` centavos), mínimo aceito pelo Asaas para cobrança recorrente.
- O mesmo valor é usado no pedido local, no checkout hospedado e nos snapshots financeiros.
- A falha do provedor mantém pedido e chave de idempotência em `FAILED`, permitindo uma nova tentativa com a mesma chave.

## Cancelamento

### Contrato do cliente

- Ao confirmar, a tela cria e guarda uma `Idempotency-Key` antes da chamada HTTP.
- Enquanto a chamada estiver pendente, a ação de cancelamento permanece indisponível.
- A mesma chave é reutilizada em reenvios automáticos ou causados por incerteza de rede.
- Após uma falha conhecida, a tela mostra a mensagem devolvida pela API e libera uma nova tentativa explícita.

### Contrato do backend

- A chave é obrigatória e representa a operação `CANCEL_SUBSCRIPTION_ITEM` de um aluno, assinatura e monitor.
- `COMPLETED` devolve o resultado previamente confirmado, sem nova chamada ao Asaas.
- `IN_PROGRESS` devolve conflito para impedir duas operações simultâneas.
- `FAILED` é reiniciado para `IN_PROGRESS` antes de uma nova tentativa com a mesma chave.
- Antes de o Asaas confirmar, não se alteram item, assinatura nem auditoria locais.
- Depois de confirmação do Asaas, o item é `CANCEL_PENDING`; quando era o último item ativo, a assinatura também vira `CANCEL_PENDING` e recebe `cancelAtPeriodEnd=true`.
- A auditoria persiste assinatura, item, monitor, autor, momento e fim do período. Ela é a fonte da tela de histórico de cancelamentos.

## Observabilidade e erros

- O controller e o serviço registram eventos seguros por etapa, com `requestId`, assinatura, monitor e estado da idempotência; nunca registram chave de API, token ou dados de cartão.
- Erros conhecidos do provedor retornam `PAYMENT_PROVIDER_ERROR` com mensagem pública de indisponibilidade temporária; falhas internas mantêm mensagem genérica.
- A resposta de cancelamento bem-sucedida informa `endsAt`; a UI usa essa data na confirmação.

## Testes de aceite

- Checkout envia R$ 5,00 ao provedor e persiste R$ 5,00 localmente.
- Falha do Asaas no cancelamento não chama mutações locais nem cria auditoria de cancelamento; a chave fica `FAILED`.
- Cancelamento concluído não chama o Asaas uma segunda vez com a mesma chave e devolve o mesmo resultado.
- Uma tentativa que falhou pode ser reiniciada com a mesma chave.
- A tela não emite duas chamadas de cancelamento enquanto a primeira está pendente e mostra a mensagem retornada pela API em caso de erro.
