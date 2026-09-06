# Flashcard Melhoria V1

## Objetivo

Aumentar a taxa de persistência de flashcards válidos e tornar explícito o
motivo de cada rejeição durante a geração a partir de chunks de documentos com
tag `FLASHCARDS`.

Este plano não deve relaxar a validação de qualidade de forma indiscriminada.
O objetivo é corrigir o contrato e a comparação de evidências, preservando:

- rastreabilidade até o chunk de origem;
- vínculo com o tópico recebido no frontend;
- cards salvos como `PENDING_REVIEW`;
- rejeição de conteúdo inventado ou sem suporte no documento;
- continuidade do processamento quando um chunk falhar.

## Diagnóstico observado

No upload mais recente:

```text
documentId: 0fad86bf-b139-4315-b3cd-443bd4765e86
tag: FLASHCARDS
documentStatus: READY
chunks: 11
chunks com tópico: 11
chunks enviados para geração: 6
falhas de chunk: 0
cards gerados: 13
cards rejeitados: 12
cards persistidos: 1
fontes persistidas: 1
```

O documento, a extração, o chunking, os vínculos de tópico, os embeddings e as
chamadas ao OpenRouter funcionaram. As respostas estruturadas também chegaram
com HTTP `200`. Portanto, o gargalo atual está depois da resposta do modelo e
antes de `persistFlashcards`.

O resumo do job atual é insuficiente:

```json
{
  "generated": 13,
  "rejected": 12,
  "persisted": 1,
  "failedChunks": 0,
  "attemptedChunks": 6
}
```

Ele informa a quantidade, mas não informa por que os candidatos foram
rejeitados.

## Ponto exato do fluxo

O descarte acontece em `FlashcardGenerationService.generateForChunk`, depois
de `requestCandidates` retornar uma resposta que passou pelo envelope
estruturado:

```text
OpenRouter
→ responseSchema.parse
→ percorre response.flashcards
→ candidateSchema.safeParse
→ valida topicId
→ validateFlashcardCandidate
→ persistCandidates
→ saveGeneratedFlashcards
```

O contador `generated` é incrementado usando a quantidade bruta de itens
retornados pelo modelo. O contador `rejected` é incrementado quando o item:

1. não corresponde ao `candidateSchema`;
2. possui `topicId` que não está em `allowedTopicIds`;
3. falha no `validateFlashcardCandidate`.

Depois, `persistCandidates` executa uma segunda validação. Essa segunda
validação é necessária como defesa, mas atualmente pode descartar itens sem
produzir uma razão observável.

## Causas possíveis de rejeição

### 1. Evidência não ancorada no chunk — principal suspeita

`validateFlashcardCandidate` normaliza a evidência e o texto-fonte e exige que
cada evidência seja uma substring literal do chunk normalizado:

```text
normalizedSource.includes(normalizedEvidence)
```

Isso é seguro contra alucinação, mas frágil para conteúdo extraído de PDF. O
modelo pode retornar uma evidência semanticamente correta, porém diferente do
texto por causa de:

- pontuação;
- quebras de linha;
- espaços antes/depois de símbolos;
- caracteres Unicode equivalentes;
- fórmulas e LaTex;
- OCR ou caracteres matemáticos extraídos de forma diferente;
- substituição de uma frase longa por uma paráfrase;
- citação que cruza uma fronteira de chunk;
- texto da página reorganizado pelo parser de layout.

Essa causa é especialmente provável porque o schema e o prompt foram
corrigidos, o modelo respondeu com sucesso e apenas 1 de 13 candidatos foi
persistido.

### 2. Falha estrutural do item

O schema do envelope pode ser válido enquanto um item interno não for aceito
por `candidateSchema`. Os campos exigidos são:

```text
front: string
back: string
evidence: string[] com ao menos um item
kind: DEFINITION | FORMULA | RULE | EXCEPTION | APPLICATION
difficulty: EASY | MEDIUM | HARD | null
topicId: string não vazio
```

Com o JSON Schema estrito atual, esta causa deve ser menos frequente, mas
continua sendo necessário registrá-la porque o fallback/provedor pode tratar
detalhes de schema de forma diferente.

### 3. Tópico inválido

O `topicId` precisa ser exatamente um dos tópicos vinculados ao documento/chunk.
O vínculo já está correto (`11` links para `11` chunks), mas o modelo ainda pode
retornar um ID inventado, vazio ou com erro de cópia.

### 4. Limites de qualidade

`validateFlashcardCandidate` rejeita:

- frente vazia;
- verso vazio;
- frente menor que 10 ou maior que 300 caracteres;
- verso menor que 2 ou maior que 1500 caracteres;
- frente igual ao verso;
- evidência ausente;
- evidência ausente do texto-fonte.

Esses limites não devem ser removidos. Devem aparecer no relatório para
distinguirmos card ruim de evidência incompatível.

## Melhoria proposta

### Fase 1 — tornar as rejeições observáveis

Criar um resultado de validação único e reutilizável que sempre preserve a
razão:

```ts
type FlashcardRejectionReason =
  | 'INVALID_SCHEMA'
  | 'INVALID_TOPIC'
  | 'EMPTY_CARD'
  | 'INVALID_FRONT_LENGTH'
  | 'INVALID_BACK_LENGTH'
  | 'FRONT_EQUALS_BACK'
  | 'MISSING_EVIDENCE'
  | 'UNGROUNDED_EVIDENCE';
```

O serviço deve registrar contadores agregados:

```json
{
  "rejectedReasons": {
    "UNGROUNDED_EVIDENCE": 8,
    "INVALID_TOPIC": 2,
    "INVALID_SCHEMA": 2
  }
}
```

Também registrar logs por candidato sem vazar conteúdo excessivo:

```json
{
  "event": "monitor.flashcard_candidate_rejected",
  "chunkId": "...",
  "candidateIndex": 0,
  "reason": "UNGROUNDED_EVIDENCE",
  "frontHash": "...",
  "evidenceCount": 1,
  "topicIdValid": true
}
```

Não registrar tokens, chave, documento inteiro ou resposta bruta completa no
log de produção.

### Fase 2 — separar schema, qualidade e persistência

O fluxo deve diferenciar claramente:

```text
generated
  = itens retornados pelo modelo

accepted
  = itens que passaram no schema e na qualidade

persisted
  = itens aceitos gravados no banco

rejected
  = generated - accepted

duplicates
  = aceitos descartados por duplicação
```

O resumo deve conter pelo menos:

```json
{
  "generated": 13,
  "accepted": 1,
  "persisted": 1,
  "rejected": 12,
  "duplicates": 0,
  "rejectedReasons": {},
  "ineligibleReasons": {}
}
```

Hoje `rejected` mistura rejeição de qualidade, schema, tópico e eventual
duplicação. Isso dificulta o diagnóstico.

### Fase 3 — melhorar o contrato de evidência

Manter a exigência de grounding, mas ajustar o contrato para o contexto de PDF.

O agente deve receber e retornar:

```json
{
  "evidence": [
    "citação curta copiada literalmente do chunk"
  ]
}
```

O prompt deve exigir:

- copiar a evidência caractere a caractere quando possível;
- usar uma citação curta, não uma paráfrase;
- não incluir aspas externas na string, salvo quando elas fazem parte do texto;
- escolher evidência contida em uma única unidade textual do chunk;
- não usar a pergunta ou a resposta como evidência;
- retornar `evidence: []` apenas se o contrato permitir que o candidato seja
  rejeitado; para cards válidos, sempre exigir pelo menos uma evidência.

O usuário/fonte não deve ser obrigado a alterar o texto extraído. A correção
deve ocorrer no contrato e na validação do worker.

### Fase 4 — normalização de evidência em duas camadas

Implementar comparação em camadas, sem aceitar paráfrase livre:

1. normalização atual: NFKC, whitespace, trim e comparação case-insensitive;
2. normalização específica de PDF para quebras de linha, espaços junto a
   pontuação e símbolos matemáticos seguros;
3. fallback controlado por janela de texto quando a evidência tiver pequenas
   diferenças de hifenização/quebra de linha;
4. se ainda não houver correspondência, rejeitar como
   `UNGROUNDED_EVIDENCE`.

Não usar similaridade semântica para aprovar automaticamente uma evidência que
não esteja ancorada no texto. Embeddings podem ser usados apenas como auxílio
diagnóstico ou para sugerir a evidência ao professor.

### Fase 5 — evitar cards excessivamente dependentes da extração

Quando um chunk contiver fórmulas ou layout difícil, o agente deve preferir:

- evidência curta e textual;
- uma única frase completa;
- não citar tabelas ou fórmulas quebradas em múltiplas linhas;
- marcar o conteúdo para revisão quando não conseguir uma evidência literal.

Conteúdo visual continua fora desta V1. Não ativar OCR nem adicionar pipeline
multimodal nesta correção.

## Contrato final esperado

O JSON enviado pelo modelo deve continuar sendo:

```json
{
  "eligible": true,
  "reason": "CONCEPTUAL_CONTENT",
  "flashcards": [
    {
      "front": "Como é definido um triângulo?",
      "back": "É um polígono formado por três segmentos de reta.",
      "evidence": [
        "Um triângulo é um polígono formado por três segmentos de reta."
      ],
      "kind": "DEFINITION",
      "difficulty": "EASY",
      "topicId": "b932ffa2-fbf0-4834-aa79-31564442a75f"
    }
  ]
}
```

O JSON Schema deve permanecer estrito e com `items` completamente definido.
Nenhum campo legado como `sourceQuote` ou `type` deve ser aceito como substituto.

## Alterações previstas

### Arquivos principais

- `src/worker/services/flashcard/flashcard-quality.service.ts`
  - expor razões tipadas;
  - centralizar resultado detalhado da validação;
  - adicionar comparação de evidência compatível com PDF;
  - manter os limites atuais.

- `src/worker/services/flashcard/flashcard-generation.service.ts`
  - contabilizar `accepted`, `duplicates` e `rejectedReasons`;
  - registrar rejeição por candidato;
  - não validar o mesmo card silenciosamente sem preservar a razão;
  - manter `topicId` limitado aos tópicos permitidos;
  - manter fallback de modelo e isolamento por chunk.

- `src/worker/services/document-worker.service.ts`
  - incluir os novos contadores no `outputSummary` do job;
  - manter o documento `READY` quando não houver falha operacional.

### Testes

- `src/worker/services/__tests__/flashcard-quality.service.test.ts`
  - razão para cada falha;
  - evidência literal válida;
  - evidência com quebra de linha/espaçamento típico de PDF;
  - paráfrase não aprovada automaticamente.

- `src/worker/services/__tests__/flashcard-generation.service.test.ts`
  - resumo com `accepted` e `rejectedReasons`;
  - card sem tópico;
  - card com schema inválido;
  - card com evidência não ancorada;
  - duplicação contabilizada separadamente;
  - card válido persistido com `PENDING_REVIEW` e fonte.

- `src/worker/services/__tests__/document-worker.service.test.ts`
  - job `GENERATE_FLASHCARD_CANDIDATES` preserva todos os contadores;
  - falha operacional continua separada de rejeição de conteúdo.

## Critérios de aceite

- O job informa o motivo de cada rejeição em `rejectedReasons`.
- Um card válido com evidência literal é persistido.
- Uma paráfrase sem suporte literal continua sendo rejeitada.
- Quebras de linha e pequenas variações de extração de PDF não rejeitam um
  card quando a evidência ainda é claramente a mesma sequência textual.
- `topicId` inválido nunca é persistido.
- Cards persistidos continuam com `PENDING_REVIEW` e `flashcard_sources`.
- O resumo diferencia `generated`, `accepted`, `persisted`, `rejected` e
  `duplicates`.
- Falhas do provider continuam sendo reportadas como `failedChunks`, não como
  rejeição de qualidade.
- A suíte de flashcards, o typecheck e um teste real pelo frontend passam.

## Ordem de implementação

1. Adicionar testes de razões e resumo, confirmando RED.
2. Implementar resultado detalhado da validação.
3. Implementar normalização segura de evidência de PDF.
4. Atualizar geração e resumo do job.
5. Atualizar logs sem expor conteúdo sensível.
6. Rodar testes focados e typecheck.
7. Reiniciar o worker.
8. Fazer novo upload pelo frontend.
9. Conferir logs e as tabelas `flashcards` e `flashcard_sources`.
10. Comparar `generated`, `accepted`, `rejectedReasons` e `persisted`.

## Fora de escopo da V1

- OCR;
- geração multimodal;
- revisão humana automática;
- aprovação automática de paráfrases por embeddings;
- alteração do modelo principal/fallback;
- remoção da exigência de evidência;
- alteração do vínculo documento–tópico–chunk;
- migração de dados antigos.
