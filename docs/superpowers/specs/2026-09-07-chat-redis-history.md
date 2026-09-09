# Especificação — Histórico temporário do Chat no Redis

**Data:** 2026-09-07  
**Status:** implementada na V1  
**Escopo:** histórico temporário da conversa do aluno, sem persistência em PostgreSQL.

## 1. Objetivo

Manter o contexto recente do chat no Redis durante a sessão de estudo, permitindo que a IA receba as últimas interações sem salvar o histórico permanentemente no banco.

O histórico será removido por expiração após cinco horas desde a última atividade relevante ou por encerramento explícito da conversa.

## 2. Configuração atual do Redis

O Redis existente é compartilhado com a BullMQ e atualmente é usado para a fila de documentos.

- Variável local: `.env:15` — `REDIS_URL`.
- Exemplo de ambiente: `.env.example:12`.
- Validação da variável: `src/config/env.ts:19`.
- Conexão da fila na API: `src/queues/document.queue.ts:11`.
- Conexão do worker: `src/worker.ts:31`.
- Fila atual: `monitor-documents`.

O histórico poderá reutilizar a mesma instância Redis, mas deverá usar uma conexão própria na API e um namespace de chaves separado da BullMQ.

## 3. Limites aprovados

```text
TTL por inatividade: 5 horas
TTL em segundos: 18000
Mensagens do aluno: no máximo 20
Respostas da IA: no máximo 20
Mensagens totais no contexto: no máximo 40
```

As 40 mensagens representam até 20 interações completas:

```text
mensagem do aluno 1 + resposta da IA 1
mensagem do aluno 2 + resposta da IA 2
...
mensagem do aluno 20 + resposta da IA 20
```

Se a geração ainda estiver pendente, o histórico poderá conter temporariamente mais mensagens de um papel do que do outro, mas nunca ultrapassará 40 registros.

## 4. Chaves Redis

Formato da chave principal:

```text
chat:history:v1:{studentId}:{monitorId}:{subjectId}
```

Essa chave não será construída com valores fornecidos livremente pelo frontend. O backend deve validar o escopo e utilizar o `studentId` resolvido pela sessão.

As chaves da BullMQ permanecem separadas pelo namespace próprio da biblioteca, sem operações globais como `FLUSHDB`.

## 5. Estrutura da mensagem

Cada item do histórico será armazenado como JSON em uma lista Redis cronológica:

```json
{
  "id": "uuid-ou-request-id",
  "role": "student",
  "content": "Pode explicar este conceito?",
  "createdAt": "2026-09-07T12:00:00.000Z"
}
```

Papéis permitidos:

- `student`;
- `assistant`;
- `system`, somente se for necessário para contexto técnico.

Não armazenar tokens de sessão, credenciais, chaves de provedor ou dados desnecessários do aluno dentro do histórico.

## 6. Ciclo de atividade e expiração

O TTL é deslizante e sempre representa:

```text
última atividade relevante + 5 horas
```

São atividades relevantes:

- mensagem aceita do aluno;
- resposta final da IA;
- resposta parcial relevante durante streaming, caso o streaming seja implementado.

Não renovam o TTL:

- apenas abrir a tela;
- consultas repetidas ao histórico;
- troca de componentes no frontend.

Após cada gravação, o adaptador deve executar uma renovação equivalente a:

```text
RPUSH chave mensagem
LTRIM chave -40 -1
EXPIRE chave 18000
```

O encerramento explícito é exposto por `DELETE /api/v1/student/monitors/:monitorId/chat/subjects/:subjectId/messages`.
Depois de repetir a autorização do mesmo escopo, a API remove a chave com `DEL` e retorna
`204`. O frontend só limpa a conversa local após essa confirmação.

O encerramento explícito deve remover a chave com `DEL`, depois de repetir a autorização do mesmo escopo.

## 7. Contrato público

### Enviar mensagem

```http
POST /api/v1/student/monitors/:monitorId/chat/subjects/:subjectId/messages
```

O endpoint deve:

1. validar a sessão;
2. resolver o aluno pelo usuário autenticado;
3. confirmar assinatura ou matrícula válida;
4. confirmar que a matéria pertence ao monitor;
5. adicionar a mensagem ao histórico temporário;
6. recuperar no máximo 40 mensagens em ordem cronológica;
7. encaminhar o contexto para a geração da IA;
8. adicionar a resposta final ao Redis;
9. renovar o TTL.

### Consultar histórico

```http
GET /api/v1/student/monitors/:monitorId/chat/subjects/:subjectId/messages
```

A consulta deve repetir a autorização. O limite máximo de retorno será 40 mensagens.

### Encerrar conversa

```http
DELETE /api/v1/student/monitors/:monitorId/chat/subjects/:subjectId/messages
```

O endpoint deve repetir a autorização e remover somente a chave daquele escopo.

## 8. Isolamento com BullMQ

O Redis compartilhado é aceitável na V1, desde que:

- o chat nunca use comandos de limpeza global;
- as chaves do chat tenham prefixo `chat:history:v1:`;
- a fila continue usando a configuração BullMQ existente;
- a política de eviction não remova indiscriminadamente jobs ativos;
- o uso de memória seja monitorado.

Quando o volume do chat crescer, o histórico deverá migrar para uma instância Redis separada sem alterar o contrato público da API.

## 9. Testes obrigatórios

- adiciona mensagem e renova TTL;
- mantém no máximo 40 mensagens;
- preserva a ordem cronológica;
- expira cinco horas após a última atividade;
- não renova TTL em consulta simples;
- remove somente o escopo autorizado no encerramento;
- impede acesso com monitor não assinado;
- impede acesso com matéria de outro monitor;
- não interfere nas chaves da BullMQ.

## 10. Fora desta implementação

- persistência permanente no PostgreSQL;
- resumo automático de conversas;
- busca vetorial;
- geração real do modelo;
- streaming SSE;
- anexos de arquivos.
