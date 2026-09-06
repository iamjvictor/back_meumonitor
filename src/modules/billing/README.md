# Billing module

Este módulo é o limite do domínio de cobrança. As rotas públicas de compra e
assinatura são compostas por `billing.module.ts`; detalhes de persistência,
checkout simulado, idempotência e confirmação não devem ser importados por
outros contextos do backend.

## Contrato de extração

- entrada: identidade autenticada do aluno, monitores e intenção de cobrança;
- saída: compra, checkout e estado da assinatura;
- efeitos: cliente Stripe, assinatura recorrente, itens, eventos de webhook e
  enrollments;
- idempotência: chave da compra e `provider_event_id` do webhook;
- fronteira: nenhum controller de aluno deve chamar Stripe diretamente.

Quando a integração real for adicionada, os adapters Stripe e webhook devem
ser colocados neste módulo. A aplicação principal deverá continuar apenas
registrando as rotas e fornecendo configuração.
