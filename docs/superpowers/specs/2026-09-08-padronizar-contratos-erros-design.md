# Padronização de Contratos e Erros — Design

**Data:** 2026-09-08  
**Status:** Design aprovado em conversa; aguardando revisão desta spec antes do plano de implementação.

## Objetivo

Criar um contrato único e seguro para erros HTTP e validação, substituir erros genéricos por erros tipados, remover dados sensíveis dos logs e eliminar `any` dos principais payloads HTTP, billing, webhooks, compras e integrações Prisma.

## Contrato público

Toda resposta de erro HTTP padronizada terá este formato:

```json
{
  "error": {
    "code": "MONITOR_NOT_ACCESSIBLE",
    "message": "Você não possui acesso a este monitor.",
    "details": null
  }
}
```

Campos:

- `code`: identificador estável para o frontend e integrações.
- `message`: mensagem segura e compreensível para o usuário.
- `details`: detalhes de validação seguros ou `null`; nunca conterá stack trace, token, senha, query SQL, payload integral ou credenciais.

Respostas de sucesso não serão alteradas nesta fase, exceto quando uma rota precisar de schema explícito para documentar e validar seu formato.

## `AppError`

Criar uma classe de aplicação com os seguintes dados:

```ts
new AppError({
  code: 'MONITOR_NOT_ACCESSIBLE',
  statusCode: 403,
  publicMessage: 'Você não possui acesso a este monitor.',
  internalDetails: { monitorId, userId },
  cause: error,
})
```

Regras:

- `code`, `statusCode` e `publicMessage` são obrigatórios.
- `internalDetails` é opcional e somente para observabilidade segura.
- `cause` é opcional e não será serializado na resposta pública.
- Códigos não podem expor mensagens derivadas de banco, provedor externo ou exceção bruta.
- Erros desconhecidos serão convertidos em `INTERNAL_SERVER_ERROR` com status `500`.

O catálogo inicial deverá cobrir autenticação, autorização, validação, recursos ausentes, conflitos de negócio, limites e indisponibilidade de integração. Códigos existentes como `STUDENT_NOT_FOUND`, `PURCHASE_NOT_FOUND` e `MONITOR_NOT_ACCESSIBLE` deverão ser preservados quando já fazem parte do contrato do frontend.

## Error handler global

O `server.ts` terá um único error handler responsável por:

1. reconhecer `AppError`;
2. reconhecer erros de validação Zod/Fastify;
3. mapear erros conhecidos de domínio e Prisma;
4. registrar somente metadados seguros;
5. responder sempre no contrato público;
6. ocultar detalhes internos de erros inesperados.

O handler deve incluir `requestId` nos logs, mas nunca registrar o objeto de erro inteiro. Logs podem conter código, status, rota, método, usuário anonimizado ou id interno e mensagem sanitizada.

## Segurança de logs

É proibido registrar diretamente:

- `error` ou `err` completos;
- headers `Authorization` e cookies;
- tokens, senhas, chaves de API e webhooks;
- bodies integrais de compras, webhooks ou autenticação;
- dados pessoais sem necessidade operacional;
- queries ou objetos Prisma completos.

Criar helper de logging seguro que aceite somente campos permitidos e serialize `cause` como tipo/código/mensagem sanitizada, quando necessário para diagnóstico.

## Validação Zod

Criar schemas estritos para entradas e respostas principais, começando por:

- autenticação e cadastro/login;
- perfil de aluno e professor;
- rotas protegidas de acesso e flashcards;
- chat;
- compras e subscriptions;
- checkout simulado e webhooks;
- tentativas de questões;
- desafios diários.

Schemas de entrada devem usar `.strict()` quando o endpoint não aceitar campos adicionais. IDs devem usar o formato efetivamente adotado pelo domínio, preferencialmente UUID quando aplicável. Respostas principais devem ser validadas no limite do controller ou service, sem expor objetos Prisma diretamente.

Falhas Zod terão `VALIDATION_ERROR`, status `422` para payload semanticamente inválido, ou `400` quando o contrato atual e o tipo de falha forem sintáticos. A migração deverá preservar o status já consumido pelo frontend quando não houver razão de segurança para alterá-lo.

## Remoção de `any`

Prioridade de substituição:

1. controllers de compras e subscriptions;
2. checkout e webhooks;
3. payloads de rotas protegidas;
4. adapters de integrações externas;
5. repositories Prisma e respostas de domínio.

Usar tipos derivados de Zod (`z.infer`), tipos de request Fastify e interfaces de portas. `unknown` será usado para dados externos antes da validação. `any` só poderá permanecer com justificativa documentada em uma integração que não ofereça tipagem substituível.

## Estratégia de migração

Usar migração incremental:

1. implementar `AppError`, catálogo, resposta e logger seguro;
2. escrever testes RED para o handler e contratos;
3. migrar auth e rotas protegidas já modularizadas;
4. migrar billing, compras e webhooks, que têm maior risco financeiro;
5. migrar chat, questões e desafios diários;
6. substituir `any` por área;
7. adicionar schemas de resposta e remover respostas Prisma diretas;
8. executar auditoria final de `any`, logs inseguros e respostas fora do padrão.

Durante a transição, poderá existir um adapter de compatibilidade para manter o formato antigo de erros em endpoints que ainda tenham consumidores não migrados. Esse adapter deve ficar explícito e ter prazo de remoção definido no plano, não espalhado em cada controller.

## Testes TDD

Cada unidade seguirá RED → GREEN → REFACTOR.

Cobertura mínima:

- serialização pública de `AppError` sem detalhes internos;
- conversão de erro desconhecido para `500`;
- conversão de Zod para `VALIDATION_ERROR`;
- preservação de códigos e status de autenticação/autorização;
- ausência de token, cookie e payload sensível nos logs;
- mapeamento de erros Prisma e integrações externas;
- rejeição de campos extras em schemas estritos;
- validação das respostas principais;
- typecheck, build e testes dos módulos migrados.

## Fora de escopo

- alterar regras de negócio de billing, compras, chat ou autenticação;
- implementar novos fluxos de pagamento;
- alterar o provedor de autenticação;
- modificar a estratégia de contexto Redis do chat;
- corrigir falhas preexistentes sem relação com contratos/erros;
- padronizar logs do worker inteiro antes da camada HTTP estar estável.

## Critérios de conclusão

- Existe um `AppError` único e um error handler global.
- Respostas de erro migradas seguem `{ error: { code, message, details } }`.
- Erros desconhecidos não expõem detalhes internos.
- Logs não registram objetos de erro completos nem credenciais.
- Áreas prioritárias não usam `any` em payloads HTTP, billing, webhooks, compras e integrações migradas.
- Entradas e respostas principais possuem schemas Zod.
- Testes TDD, typecheck e build passam, com falhas preexistentes documentadas separadamente.
