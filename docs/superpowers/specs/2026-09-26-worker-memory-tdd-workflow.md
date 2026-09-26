# Workflow TDD para otimização de memória do worker

## Objetivo

Definir como subagentes implementam e revisam cada alteração, com evidência de RED, GREEN e regressão. Todos os implementadores e revisores desta iniciativa usam `gpt-5.6-luna`, conforme decisão do projeto.

## Regra central

Nenhum código de produção é escrito antes de existir um teste que falhe pelo comportamento ausente. O agente deve registrar a falha RED; um teste que já passa não autoriza implementação.

## Fluxo por tarefa

1. O controlador entrega a um implementador Luna apenas uma tarefa do plano, a spec aplicável e interfaces já produzidas.
2. O agente registra baseline do escopo.
3. RED: escreve um teste mínimo e executa o comando focado até observar a falha correta.
4. GREEN: implementa o mínimo e faz o teste focado passar.
5. REFACTOR: melhora estrutura sem ampliar comportamento.
6. Executa o gate da tarefa e produz relatório.
7. Um revisor Luna diferente verifica spec, teste, diff e relatório.
8. Finding bloqueante volta ao mesmo implementador por até três rodadas; depois disso um novo Luna assume o fix.
9. Somente após aprovação a próxima tarefa começa.
10. Ao final, um Luna novo revisa toda a branch e o controlador executa o gate completo.

Subagentes de implementação não trabalham em paralelo quando compartilham `worker.ts`, `env.ts`, contratos do parser ou testes de integração. Revisões somente leitura podem ocorrer em paralelo.

## Relatório obrigatório por agente

Salvar um relatório no workspace SDD contendo:

- tarefa, commit base e commit final;
- arquivos alterados;
- versão Node/npm e diretório de execução;
- comando RED, exit code e trecho da falha esperada;
- comando GREEN, exit code e duração;
- comandos de integração/regressão e resultados;
- typecheck, lint e `git diff --check`;
- testes não executados e motivo;
- confirmação de ausência de chamadas reais a LLM, Redis, PostgreSQL e parser em testes determinísticos;
- riscos residuais ou rulings feitos.

Relatório sem evidência RED é rejeitado.

## Matriz de testes

| Área | Unitário focado | Integração/contrato | Gate da tarefa |
| --- | --- | --- | --- |
| Retenção/abort | adapter + orchestrator | parser persistence/HTTP | parser unit + contratos |
| Telemetria/tracker | worker-memory + tracker | fronteiras do document worker | health + worker tests |
| Projeção Docling | projection service | ingestion V3 + worker | layout contract + fluxo offline |
| Cleanup/transporte | PDF extraction + adapter | multipart/retry | parser unit + corpus pequeno |
| Concorrência | env em processo filho + factory | worker fake | typecheck + worker tests |
| Lazy load | loader + chunks | smoke em processo filho | chunk tests + build |

## Comandos de baseline

```bash
npm run test:document-parser-unit
node --import tsx --test \
  src/worker/services/document-parser/__tests__/document-parse-orchestrator.service.test.ts \
  src/health/__tests__/worker-health.test.ts
node --import tsx --experimental-test-module-mocks --test \
  src/worker/services/__tests__/document-worker.service.test.ts \
  src/worker/services/worker-database-bootstrap.test.ts
npm run test:document-ingestion-v3
npm run typecheck
npm run lint -- --quiet
git diff --check
```

## Gates por comportamento

### Retenção

- 100 layouts inline, zero retidos;
- mapa in-flight vazio após sucesso, erro, resposta inválida e abort;
- uma requisição para chamadas concorrentes equivalentes.

### Telemetria

- schema completo, números em bytes e contexto correto;
- sem conteúdo sensível;
- timer encerrável e sem histórico local;
- logger falho não afeta job.

### Docling

- zero import/chamada PDF.js no modo Docling;
- páginas, fórmulas, tabelas e imagens preservadas;
- modo legado selecionável;
- fallback Docling não muda silenciosamente de parser.

### Recursos

- cleanup em todos os caminhos;
- retry envia bytes, hash, nome e MIME corretos;
- nenhum buffer guardado em campo de serviço.

### Concorrência e lazy loading

- default de documentos `2`, valores inválidos falham;
- concorrência `1` impede sobreposição;
- inicialização concorrente usa uma Promise;
- falha de inicialização permite retry;
- chunks preservam encoding, limites e overlap.

## Gate final determinístico

```bash
npm run typecheck
npm run lint -- --quiet
npm run build
npm run test:document-parser-unit
npm run test:document-parser-contract
npm run test:document-parser-layout-contract
npm run test:document-parser-persistence-contract
npm run test:document-parser-storage-contract
npm run test:document-ingestion-v3
npm run test:documents
npm run test:chunk-quality
npm run test:fluxo-offline
git diff --check
```

`test:fluxo-docling` pode chamar o parser real e só entra no gate de homologação quando o serviço e fixtures estiverem disponíveis. Scripts que escrevem relatórios devem rodar com verificação de `git status` para não misturar artefatos na branch.

## Ensaio de memória separado

RSS não é assert de teste unitário. O ensaio ocorre em Node 22, ambiente controlado e mesma revisão/configuração:

1. 5 minutos em repouso;
2. 10 jobs de aquecimento;
3. 100 jobs em cinco blocos de 20;
4. 30 segundos de repouso entre blocos;
5. três repetições com concorrência 1 e depois 2;
6. registrar RSS, heap, external, arrayBuffers, duração, vazão, falhas e OOM.

Critério: após aquecimento e GC apenas diagnóstico, crescimento de `heapUsed` entre primeiro e último bloco não excede o maior entre 10 MiB e 10% do primeiro bloco. A mediana dos picos com concorrência equivalente deve cair ao menos 20% para cumprir a meta de otimização.

## Limitações conhecidas

- não existe `npm test` geral;
- testes com `t.mock.module` exigem `--experimental-test-module-mocks`;
- `env.ts` é singleton de import; cenários de ambiente usam processo filho;
- `worker.ts` possui efeitos no top-level e deve expor factories antes de testes de wiring;
- testes que alteram `process.env` não devem ser paralelizados indiscriminadamente;
- testes determinísticos não fazem asserts de RSS em CI compartilhada.

