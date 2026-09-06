# TDD — correções finais de flashcards (2026-08-27)

- RED: regressões para lock compartilhado com IDs ordenados, `PARTIAL_SUCCESS`/`FAILED` duráveis, resumo sanitizado, envelope misto, signal já abortado e body pendurado.
- GREEN: helper único de `pg_advisory_xact_lock(hashtextextended(documentId, 0))` usado por chunks e sources na mesma transação; status parcial/falha no job; resumo com allowlist e detalhes de chunks reduzidos a `{ chunkId, code }`; envelope `unknown[]` com `safeParse` por item e timeout cobrindo `response.json()`.
- Garantia de concorrência: toda criação de `FlashcardSource` resolve os `documentId`s dos chunks dentro da transação, adquire as mesmas chaves usadas por `saveExtractedChunks` em ordem lexicográfica, e só então cria cards/sources. Isso serializa source creation e `deleteMany` por documento e evita deadlock quando há múltiplos documentos.
- Fora do MVP: suporte multimodal não foi implementado nesta rodada; permanece fora do escopo da especificação.

Comandos e contagens verificadas:

```text
npm run test:flashcard-generation — 6 arquivos, 6 pass, 0 fail
npm run typecheck — exit 0
npm run prisma:validate — schema válido
git diff --check — exit 0
```
