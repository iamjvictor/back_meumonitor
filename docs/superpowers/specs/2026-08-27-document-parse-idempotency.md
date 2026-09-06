# Spec: idempotência de parse runs após timeout/retry

## Problema

Quando uma tentativa do parser expira, o orquestrador salva um registro
`FALLBACK_REQUIRED` com uma `idempotency_key`. Um retry posterior pode obter
sucesso do parser com outro `parseRunId`, mas a persistência usa `id` como chave
do `upsert`. O banco então rejeita a operação pela restrição única de
`idempotency_key`.

## Comportamento desejado

- `idempotency_key` é a identidade lógica do parse run.
- Repetir a mesma operação deve atualizar o registro existente por essa chave.
- O `parseRunId` persistido deve permanecer canônico para que o layout e os
  updates posteriores encontrem o mesmo registro.
- O retry não pode criar registros duplicados nem falhar com `P2002`.
- Operações com chaves diferentes continuam criando runs independentes.
- O comportamento de fallback e o contrato `ParseRunStore` permanecem intactos.

## Escopo

- Adicionar testes de regressão no repositório/orquestrador, primeiro em RED.
- Corrigir persistência e propagação do identificador canônico.
- Não alterar Docling, OCR ou o schema do banco.
- Verificar com testes unitários, typecheck e contrato do parser.

## Critérios de aceite

1. Um fallback seguido de sucesso para a mesma chave termina com um único
   `DocumentParseRun` e status de sucesso.
2. O `parseRunId` retornado pelo retry é o ID persistido originalmente.
3. O layout associado usa o ID canônico e pode ser persistido.
4. Duas chaves diferentes não compartilham o mesmo run.
5. Suítes existentes continuam passando.
