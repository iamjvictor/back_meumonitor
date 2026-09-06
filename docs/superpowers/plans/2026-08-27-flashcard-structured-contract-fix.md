# Plano: corrigir contrato estruturado de flashcards

Spec: `docs/superpowers/specs/2026-08-27-flashcard-structured-contract-fix.md`

## Tarefas

- [ ] Adicionar teste de integração unitária que rejeite schema interno vazio e
  aceite um card completo compatível com o backend.
- [ ] Substituir `items: {}` pelo schema estrito dos candidatos e atualizar o
  prompt para exigir exatamente os campos do contrato.
- [ ] Executar testes focados e `npm run typecheck`.
- [ ] Revisar o diff e confirmar que a persistência continua usando tópico
  permitido, `PENDING_REVIEW` e fonte do chunk.
