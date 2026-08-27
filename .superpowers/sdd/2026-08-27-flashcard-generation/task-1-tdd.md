# Task 1 — Registro TDD

## Limitação do registro histórico

A fase RED do primeiro ciclo não foi capturada no registro persistente e não pode ser reconstruída. Este arquivo não afirma que o teste planejado daquela rodada foi executado em RED.

```text
## RED isolado registrado

Como limitação explícita, foi executado apenas um RED isolado, sem alterar o produto, tentando importar um caminho de contrato deliberadamente ausente:

```bash
node --input-type=module -e "try { await import('./src/worker/services/flashcard/flashcard-quality.service.missing.js'); process.exit(1); } catch (error) { if (error?.code !== 'ERR_MODULE_NOT_FOUND') process.exit(2); console.log('RED isolated: ERR_MODULE_NOT_FOUND (contract absent)'); }"
```

Resultado real:

```text
RED isolated: ERR_MODULE_NOT_FOUND (contract absent)
exit_code=0
```

## GREEN

Após as alterações, o teste focado passou:

```bash
node --import tsx --test src/worker/services/__tests__/flashcard-quality.service.test.ts src/worker/services/__tests__/flashcard-front-hash.compatibility.test.ts
```

Resultado real:

```text
tests 2
pass 2
fail 0
exit_code=0
```

Também passaram:

```bash
npm run typecheck
```

O `git diff --check` global também foi executado, mas encontrou um blank line pré-existente fora do escopo em `src/models/monitor.model.ts:32`. O diff staged apenas desta rodada passou em `git diff --cached --check`.
