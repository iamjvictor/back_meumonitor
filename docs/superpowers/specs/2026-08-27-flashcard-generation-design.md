# Geração de Flashcards por Bloco

## Objetivo

Gerar candidatos de flashcards a partir de chunks de documentos enviados com a tag `flashcards`, preservando rastreabilidade, validação e revisão humana.

## Decisões

- O código controla o fluxo; nenhum orquestrador LLM decide a próxima etapa.
- Somente blocos `THEORY`, `DEFINITION`, `FORMULA`, `EXAMPLE` e `QUESTION` com conteúdo suficiente são elegíveis.
- O modelo principal textual é `openai/gpt-5-mini`; Gemini é fallback para conteúdo multimodal ou falha do modelo principal.
- A geração retorna JSON estruturado com até cinco candidatos por chunk.
- Validações determinísticas rejeitam cards vazios, duplicados, sem evidência ou com frente e verso equivalentes.
- Cards válidos são salvos diretamente em `flashcards` com `PENDING_REVIEW` e vinculados a `flashcard_sources`.
- A geração automática ocorre para documentos com tag `FLASHCARDS`; documentos `QUESTIONS` continuam focados em questões e RAG.
- A geração automática de flashcards não usa questões não validadas como fonte.

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
