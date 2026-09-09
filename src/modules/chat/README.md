# Chat por matéria

Este módulo representa o limite do domínio de chat dentro da API principal.

Na V1, ele roda no mesmo processo do Fastify. A organização por portas e casos de uso existe para permitir uma extração futura para um serviço independente sem alterar o contrato público do frontend.

## Limites

- `services/`: casos de uso do chat;
- `ports/`: contratos para persistência, autorização, recuperação e geração;
- `models/`: schemas de entrada e tipos do domínio;
- `repositories/`: adaptadores de autorização e histórico temporário em Redis;
- `controllers/` e `routes/`: adaptadores HTTP da API;
- `providers/`: adapters de modelo/RAG que podem ser substituídos por clientes externos.

O módulo não deve ser importado diretamente por módulos de billing, documentos ou questões. Integrações com questão devem passar por contratos próprios do chat.

## Autorização inicial

A API expõe `POST /api/v1/student/monitors/:monitorId/chat/subjects/:subjectId/messages`.
Os identificadores de escopo ficam na URL e a mensagem vai no corpo:

```json
{
  "message": "Pode explicar este conceito?",
  "topicId": null,
  "questionContext": null
}
```

O usuário é obtido pela sessão autenticada. A API resolve o `studentId` internamente,
confirma que a matéria pertence ao monitor e exige assinatura ativa ou matrícula ativa.
Depois da autorização, o `ChatService` lê o histórico do Redis, salva a mensagem do aluno,
chama o `OpenRouterChatGateway`, salva a resposta final e retorna o conteúdo ao frontend.

O gateway não conhece Redis nem a rota HTTP. Ele implementa `ChatGenerationPort` e recebe
o histórico e o contexto autorizado já preparados pelo caso de uso. Isso permite trocar o
OpenRouter por outro provider ou por um serviço HTTP externo sem alterar o frontend.

Também estão disponíveis:

- `GET /api/v1/student/monitors/:monitorId/chat/subjects/:subjectId/messages` para restaurar o histórico temporário;
- `DELETE /api/v1/student/monitors/:monitorId/chat/subjects/:subjectId/messages` para encerrar a conversa e liberar a chave do Redis.

O histórico é isolado por aluno, monitor e matéria, tem TTL deslizante de cinco horas a
partir da última atividade e mantém no máximo 40 mensagens. O DELETE exige a mesma
autorização do envio; não é possível apagar o histórico de outro escopo apenas conhecendo
seus identificadores.

O RAG roda dentro do módulo, antes da geração. Ele reutiliza o retrieval autorizado,
registra apenas métricas agregadas (candidatos, selecionados, scores e duração) e não
registra o texto integral das mensagens em logs de produção. Falhas de embedding ou
retrieval seguem sem evidências; falhas de geração não salvam uma resposta incompleta.

## Como acompanhar a qualidade durante os testes

Todos os eventos abaixo carregam o mesmo `requestId`, permitindo seguir uma mensagem do
início ao fim no log:

1. `chat.message_received`: entrada recebida, escopo, questão e tamanho da mensagem;
2. `chat.rag_started` e `chat.rag_query_built`: histórico usado e tamanho da consulta;
3. `chat.rag_embedding_completed`: dimensões e duração do embedding;
4. `chat.rag_retrieval_completed`: candidatos, evidências selecionadas, scores e duração;
5. `chat.rag_context_assembled`: tamanho do contexto e quantidade de citações;
6. `chat.rag_quality_signal`: sinal operacional da recuperação;
7. `monitor.chat_generation_request_completed`: tokens, modelo, motivo de término e duração;
8. `chat.generation_completed`: resposta entregue e métricas agregadas do RAG.

O `retrievalSignal` é um indicador inicial do retrieval, não uma nota definitiva da resposta:

- `strong`: evidências selecionadas e score médio igual ou superior a `0.65`;
- `moderate`: evidências selecionadas e score médio entre `0.40` e `0.65`;
- `weak`: houve evidência, mas com score menor ou sem score agregado;
- `none`: nenhuma evidência foi recuperada ou o RAG caiu em fallback.

Para considerar a qualidade real, combinamos três camadas: (1) recuperação, verificando se
as fontes pertencem ao monitor/matéria/tópico e se o score é consistente; (2) grounding,
verificando manualmente se a resposta usa as evidências recuperadas sem inventar fatos; e
(3) pedagogia, verificando clareza, correção, passo a passo e aderência à pergunta. O log
mede principalmente a primeira camada. As duas últimas exigem avaliação por casos reais,
com resposta esperada ou revisão humana, e não devem ser inferidas apenas pelo HTTP 200.

## Benchmark da Fase 9

O benchmark controlado fica em `rag/__tests__/question-fast-path.performance.test.ts` e usa
doubles para separar o custo da arquitetura da latência externa do OpenRouter e do banco.
Ele mede questão com fonte oficial, flashcard aprovado, retrieval semântico e mensagem sem
anexo com e sem histórico.

O valor de referência observado antes do fast path foi de aproximadamente 8,1 segundos,
mas esse número incluía embedding, consulta vetorial e geração do LLM. O benchmark mede
somente o estágio de retrieval/contexto. Para comparar uma requisição real, observe os logs
`chat.rag_context_assembled` e `chat.generation_completed`; a geração do LLM continua
sendo contabilizada separadamente.

Execute com:

```bash
npm run test:chat
```

As variáveis específicas do gateway são `CHAT_AI_MODEL`, `CHAT_AI_MAX_TOKENS`,
`CHAT_AI_TEMPERATURE` e `CHAT_AI_TIMEOUT_MS`. O modelo usa `OPENROUTER_QUESTION_MODEL`
como fallback quando `CHAT_AI_MODEL` não estiver definido.

## Extração futura

Quando o volume justificar um serviço separado, a implementação local de `ChatGenerationPort` e dos adapters de autorização/RAG poderá ser substituída por um cliente HTTP interno. As rotas públicas da API e o contrato usado pelo frontend devem permanecer estáveis.
