# Modularização das Rotas Legadas — Design

**Data:** 2026-09-08  
**Status:** Design aprovado em conversa; aguardando revisão desta spec antes do plano de implementação.

## Objetivo

Extrair as responsabilidades de aluno atualmente concentradas em `src/routes/protected.routes.ts` para módulos verticais independentes, preservando os contratos HTTP existentes e removendo gradualmente regras de negócio e acesso direto ao Prisma das rotas.

## Contexto atual

`protected.routes.ts` registra autenticação e implementa diretamente:

- leitura da sessão do usuário;
- atualização/criação do perfil do aluno;
- seleção de flashcard aleatório;
- revisão de flashcard e persistência do estado SRS;
- verificação de assinatura, matrícula e propriedade do monitor;
- cancelamento de acesso a monitor;
- consultas e mutações diretas no Prisma;
- validação manual de parâmetros e construção de respostas HTTP.

O chat já possui um módulo vertical próprio e será mantido como referência. Os endpoints existentes não devem mudar de URL ou contrato como parte desta migração.

## Decisão arquitetural

Adotar uma migração incremental, no estilo strangler: cada conjunto de rotas será extraído para um módulo, validado, registrado no servidor e só então removido de `protected.routes.ts`.

Os módulos previstos são:

```text
src/modules/
  student-profile/
  student-access/
  student-flashcards/
  student-questions/
  chat/
```

Cada módulo terá um composition root `*.module.ts`, responsável por montar suas dependências e expor suas rotas. A composição receberá Prisma/repositorios por injeção; os módulos não devem criar conexões globais nem esconder dependências.

## Responsabilidade dos módulos

### `student-profile`

Conterá as operações de perfil do aluno atualmente em `protected.routes.ts`, incluindo criação idempotente quando necessária e atualização do perfil. A leitura composta de sessão será mantida separada até que seu contrato seja mapeado, pois ela também consulta dados de professor.

### `student-access`

Conterá a resolução de acesso do aluno a monitores, considerando assinatura ativa, matrícula ativa e propriedade do monitor pelo professor. Também conterá o cancelamento de acesso. A autorização deverá expor uma interface reutilizável por flashcards, questões e chat, evitando que cada módulo replique consultas de assinatura/matrícula.

### `student-flashcards`

Conterá seleção de flashcard aleatório, verificação de acesso, leitura/criação do aluno quando aplicável, revisão SRS e registro do histórico de revisão. O cálculo SRS continuará sendo usado como serviço de domínio; a persistência será encapsulada por repositório.

### `student-questions`

Conterá consultas legadas de questões que ainda estejam em `protected.routes.ts`, sem duplicar o módulo já existente de tentativas. O limite exato será confirmado no inventário da implementação; se não houver rota de consulta de questão no arquivo legado, o módulo será criado apenas como composição para a funcionalidade existente, sem movimentação artificial.

### `chat`

Permanece no módulo atual. A migração não reabre a fase 3 do chat: o contexto continuará armazenado apenas no Redis, conforme decisão anterior.

## Camadas e regras

```text
HTTP route adapter
        ↓
controller / input mapping
        ↓
application service / use case
        ↓
repository interfaces
        ↓
Prisma adapters
```

As rotas devem apenas:

1. receber parâmetros, query e body;
2. validar entradas;
3. chamar o controller/serviço;
4. traduzir resultado e erros para HTTP.

As regras de negócio, autorização e Prisma ficarão fora das rotas. Repositórios devem esconder detalhes de `where`, `include`, `upsert` e transações. Erros de domínio terão códigos estáveis para que os adapters preservem respostas como `400`, `403`, `404` e `500` já esperadas pelo frontend.

## Fluxo de registro

O `server.ts` registrará os composition roots dos módulos com o mesmo prefixo atual. A autenticação continuará aplicada no limite das rotas protegidas. Enquanto a migração estiver incompleta, `protected.routes.ts` continuará registrando apenas as rotas ainda não extraídas; uma rota não poderá ser registrada duas vezes.

## Ordem de implementação

1. Criar testes de contrato para os endpoints legados antes da movimentação.
2. Extrair perfil do aluno, por ser o limite mais simples para validar o padrão.
3. Extrair acesso a monitores e reutilizar sua interface nos módulos consumidores.
4. Extrair flashcards, incluindo revisão SRS e seus efeitos de persistência.
5. Inventariar e extrair consultas de questões, sem conflitar com tentativas já modularizadas.
6. Reduzir `protected.routes.ts` ao que ainda não foi migrado ou removê-lo quando vazio.

Cada etapa deve manter os contratos HTTP e ser independentemente testável.

## Testes orientados a TDD

Para cada extração, seguir o ciclo red-green-refactor:

1. escrever um teste que expresse o comportamento e falhe contra a ausência do novo módulo/serviço;
2. executar o teste isolado e registrar a falha esperada;
3. implementar o mínimo necessário;
4. executar o teste isolado e a suíte relacionada;
5. refatorar apenas mantendo tudo verde.

Cobertura mínima:

- composição do módulo e registro das rotas;
- validação de entrada;
- preservação dos status e códigos de erro existentes;
- autorização por assinatura, matrícula e propriedade;
- isolamento do aluno e do monitor;
- persistência do SRS e do log de revisão;
- ausência de importação direta do Prisma nos adapters HTTP;
- typecheck e build do backend.

## Fora de escopo

- alteração de URLs ou formato público das respostas;
- implementação de SSE, retry idempotente ou estados de streaming do chat;
- troca do Redis por banco de dados para contexto do chat;
- reescrita dos módulos de desafio diário, performance ou tentativas;
- correção de falhas preexistentes não causadas pela modularização.

## Critérios de conclusão

- Nenhuma rota migrada contém regra de negócio ou chamada direta ao Prisma.
- Cada módulo migrado possui composition root explícito.
- `protected.routes.ts` não contém mais perfil, acesso, flashcards ou consultas de questões migradas.
- Os contratos HTTP existentes continuam cobertos por testes.
- O ciclo TDD foi executado em cada unidade extraída.
- Typecheck, testes relevantes e build passam, com falhas preexistentes documentadas separadamente.
