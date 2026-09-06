# Geração de Flashcards por Bloco

## Objetivo

Gerar candidatos de flashcards a partir de chunks de documentos enviados com a tag `flashcards`, preservando rastreabilidade, validação e revisão humana.

## Decisões

- O código controla o fluxo; nenhum orquestrador LLM decide a próxima etapa.
- Somente blocos `THEORY`, `DEFINITION`, `FORMULA`, `EXAMPLE` e `QUESTION` com conteúdo suficiente são elegíveis.
- O modelo principal textual é `openai/gpt-5-mini`; Gemini é fallback para falha do modelo principal. Conteúdo multimodal permanece fora do MVP.
- A geração retorna JSON estruturado com até cinco candidatos por chunk.
- Validações determinísticas rejeitam cards vazios, duplicados, sem evidência ou com frente e verso equivalentes.
- Cards válidos são salvos diretamente em `flashcards` com `PENDING_REVIEW` e vinculados a `flashcard_sources`.
- A geração automática ocorre para documentos com tag `FLASHCARDS`; documentos `QUESTIONS` continuam focados em questões e RAG.
- A geração automática de flashcards não usa questões não validadas como fonte.
- Reprocessamento com `FlashcardSource` existente é abortado antes de apagar chunks, preservando chunks, sources e cards; não há cascata silenciosa nesta rodada.
- Geração multimodal e integração Postgres real estão fora do MVP desta rodada; não são consideradas implementadas.

## Limites normativos da Task 1

Os limites abaixo são inclusivos e medidos depois da normalização do texto (NFKC, whitespace consecutivo reduzido a um espaço, trim e comparação case-insensitive):

- conteúdo mínimo normalizado de bloco fonte: `FLASHCARD_MIN_SOURCE_TEXT_LENGTH = 20` caracteres;
- frente: mínimo `FLASHCARD_MIN_FRONT_LENGTH = 10` e máximo `FLASHCARD_MAX_FRONT_LENGTH = 300` caracteres;
- verso: mínimo `FLASHCARD_MIN_BACK_LENGTH = 2` e máximo `FLASHCARD_MAX_BACK_LENGTH = 1500` caracteres.

Portanto, valores exatamente iguais aos mínimos ou máximos são aceitos; valores abaixo dos mínimos ou acima dos máximos são rejeitados. Esses limites são exportados pelo contrato de qualidade para que testes e consumidores usem a mesma fonte normativa.

## Modelo existente reutilizado

O MVP usa `FlashcardKind` (`DEFINITION`, `FORMULA`, `RULE`, `EXCEPTION`, `APPLICATION`), `FlashcardStatus`, `frontHash` e `FlashcardSource`. Não haverá tabela paralela de candidatos nesta etapa.

## Fluxo

```text
documento FLASHCARDS
→ extração, blocos, chunks e embeddings
→ seleção determinística de chunks
→ geração estruturada
→ validação determinística
→ deduplicação por tópico + frontHash
→ persistência PENDING_REVIEW
```

## Critérios de aceite

- Um documento `FLASHCARDS` executa geração de flashcards depois dos embeddings.
- Um chunk sem conteúdo conceitual pode gerar zero cards sem erro.
- Nenhum card inválido ou sem `FlashcardSource` é persistido.
- Falhas de um chunk não interrompem os demais e ficam registradas no resumo do job.
- O documento termina com status coerente e o professor consegue revisar os cards existentes.

## Extensão: elegibilidade explícita no retorno do modelo

### Objetivo

O mesmo pedido estruturado que analisa o chunk deve informar se existe conteúdo
autônomo com valor de estudo. Não haverá uma chamada separada de elegibilidade.

### Contrato de saída

```json
{
  "eligible": true,
  "reason": "CONCEPTUAL_CONTENT",
  "flashcards": []
}
```

`reason` deve ser um destes valores:

```text
CONCEPTUAL_CONTENT
EXERCISE_ONLY
METADATA
TEACHER_GUIDE
ANSWER_KEY
INSUFFICIENT_CONTEXT
DUPLICATE_CONTENT
NO_STUDY_VALUE
```

Quando `eligible` for `false`, `flashcards` deve ser vazio. Quando for `true`,
o modelo pode retornar de zero a cinco cards; o código continuará rejeitando
cards sem evidência literal, com tópico inválido ou estruturalmente inválidos.

### Prompt normativo

O agente deve analisar exclusivamente o chunk recebido e decidir se há uma
definição, conceito, regra, fórmula, propriedade, classificação, relação de
causa e efeito ou distinção que possa ser estudada isoladamente. Deve rejeitar
títulos, metadados, instruções docentes, gabaritos sem explicação, exercícios
sem conceito explícito, listas, texto incompleto, exemplos sem regra e conteúdo
sem valor de revisão. Não pode usar conhecimento externo e deve retornar apenas
JSON compatível com o schema.

### Regras determinísticas pós-modelo

- `eligible=false` com cards não é um resultado aceitável e deve falhar a
  validação do lote.
- `eligible=true` com cards vazios é válido: o trecho pode ser conceitual, mas
  não conter uma unidade de recuperação suficientemente clara.
- `eligible=false` não é erro operacional; deve ser contabilizado como chunk
  analisado sem cards, preservando o motivo no resumo observável do job.
- A elegibilidade do modelo não substitui os filtros determinísticos de tipo,
  tamanho, evidência, tópico e origem.

### Critérios de aceite adicionais

- O schema exige `eligible`, `reason` e `flashcards`.
- O serviço aceita explicitamente um chunk inelegível com `flashcards: []` sem
  tentar persistir cards.
- O serviço rejeita resposta inelegível que contenha cards.
- O motivo de inelegibilidade é preservado no resultado agregado do documento.
- A resposta continua limitada a cinco cards e o fallback do modelo permanece
  funcionando.
