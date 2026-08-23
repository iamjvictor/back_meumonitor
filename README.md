# Backend - MeuMonitor AI

API HTTP independente em Fastify/TypeScript. A primeira rota implementada e o cadastro de professor.

## Estrutura

```text
backend/src/
  routes/                  # mapeamento HTTP
  controllers/             # entrada e resposta HTTP
  services/                # regras de negocio
  repositories/            # Supabase/Auth e persistencia
  models/                  # tipos e schemas dos dados
```

## Rotas de cadastro

### 1. Criar conta basica

`POST /api/v1/auth/signup`

Payload:

```json
{
  "email": "professor@example.com",
  "password": "SenhaForte123!",
  "cpf": "00000000000",
  "name": "Nome do Professor",
  "whatsapp": "5511999999999",
  "role": "teacher"
}
```

Esse endpoint e publico, cria o usuario confirmado no Supabase Auth, grava `role=teacher` em `app_metadata` e emite cookies de sessao `HttpOnly` imediatamente. A confirmacao de e-mail do Supabase fica desativada neste momento; a plataforma tera seu proprio fluxo de confirmacao posteriormente.

No Supabase, mantenha o provider de e-mail habilitado e desative apenas `Confirm email`. Se o provider estiver desativado, a API retorna `503 EMAIL_PROVIDER_DISABLED`.

### 2. Completar perfil do professor

`POST /api/v1/auth/register/teacher`

Esse endpoint exige a sessao criada no signup e recebe os dados do modal:

```json
{
  "username": "professor-exemplo",
  "pageSlug": "professor-exemplo",
  "area": "Concursos Publicos",
  "bio": "Bio do professor",
  "avatarUrl": "https://cdn.example.com/avatar.jpg",
  "instagram": "@professor",
  "tiktok": "@professor",
  "youtube": "https://youtube.com/@professor",
  "agreedTerms": true
}
```

O perfil e persistido pelo Prisma na tabela `teachers` com status `pending`. A senha nunca e persistida pela aplicacao.

### 3. Login

`POST /api/v1/auth/login`

Payload:

```json
{
  "email": "professor@example.com",
  "password": "SenhaForte123!"
}
```

O login valida as credenciais no Supabase Auth, emite os cookies `HttpOnly` de sessao e retorna `401` sem revelar se o e-mail existe.

## Buscar perfil do professor

`GET /api/v1/teachers/me`

Busca o perfil usando o `user_id` da sessao autenticada. Nao recebe `userId` pela URL ou pelo body e retorna `404` quando o professor ainda nao completou o segundo passo do cadastro.

Quando o e-mail ainda nao foi confirmado, retorna:

```json
{
  "error": "EMAIL_NOT_CONFIRMED",
  "message": "Confirme seu e-mail antes de entrar na conta."
}
```

## Autenticacao e rate limit

O middleware `authMiddleware` valida o JWT Supabase recebido no header `Authorization: Bearer <access_token>` ou no cookie `mm_access_token`, usando `supabase.auth.getUser`. Depois da validacao, o usuario fica disponivel em `request.user`. Rotas de cadastro/login permanecem publicas, pois o usuario ainda nao possui sessao nesse momento.

O signup grava `mm_access_token` e `mm_refresh_token` como cookies `HttpOnly` quando o Supabase retornar uma sessao. Se a confirmacao de e-mail estiver habilitada, a sessao pode ser nula e o frontend deve aguardar a confirmacao antes de acessar rotas protegidas. A rota de teste protegida `GET /api/v1/session` confirma a sessao atual e retorna o `userId` e o e-mail autenticado.

As chaves `SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SERVICE_ROLE_KEY` ficam somente no backend. A `service_role` e usada exclusivamente para operacoes server-side autorizadas e nunca deve ser enviada pelo frontend.

Limites atuais:

- API inteira: 100 requisicoes por minuto por IP;
- cadastro de professor: 5 requisicoes por 15 minutos por IP.

Exemplo de chamada autenticada:

```ts
await fetch(`${process.env.BACKEND_URL}/api/v1/teachers/me`, {
  headers: {
    Authorization: `Bearer ${session.access_token}`,
  },
});
```

Para proteger uma nova rota:

```ts
app.get('/teachers/me', { onRequest: authMiddleware }, async (request) => {
  return { userId: request.user.id };
});
```

O cadastro inicial continua sem esse middleware:

```ts
await fetch(`${process.env.BACKEND_URL}/api/v1/auth/register/teacher`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
  },
  body: JSON.stringify(payload),
});
```

## Logs do cadastro

As duas rotas emitem eventos estruturados no log do Fastify. Para o signup:

```text
auth.signup.request_received
auth.signup.validation_succeeded
auth.signup_started
auth.signup_completed
auth.signup.cookies_issued
auth.signup.completed
```

Para completar o perfil:

```text
teacher_profile.request_received
teacher_profile.validation_succeeded
teacher_profile.persistence_started
teacher_profile.service_started
teacher_profile.service_finished
teacher_profile.completed
```

Senhas, tokens, CPF, telefone, bio e URLs de avatar nunca sao impressos. O e-mail aparece mascarado e os campos opcionais aparecem apenas como `true/false`.

## HTTPS e Railway

O backend escuta HTTP internamente. Na Railway, o HTTPS publico e terminado automaticamente pela infraestrutura da plataforma, que fornece e renova os certificados para os dominios publicos. O frontend deve chamar a URL publica HTTPS da Railway; nao e necessario configurar certificado dentro deste processo.

## Executar

```bash
cp .env.example .env
npm install
npm run typecheck
npm run dev
```

O `npm run dev` carrega automaticamente `backend/.env`. Preencha pelo menos `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SERVICE_ROLE_KEY` antes de iniciar.

`SUPABASE_URL` deve ser a URL raiz do projeto, por exemplo `https://seu-projeto.supabase.co`. Nao inclua `/rest/v1/`, pois essa rota e usada pelo PostgREST e nao pelo cliente de Auth.

A chave publicável e usada no `signUp`; `SUPABASE_SERVICE_ROLE_KEY` fica restrita ao rollback server-side e nunca vai para o frontend.

## Prisma

O schema da aplicacao fica em `prisma/schema.prisma`. O Prisma usa somente `DATABASE_URL` em runtime e nas migrations.

Depois de preencher `DATABASE_URL` no `.env`:

```bash
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate -- --name create_teachers
```

O Prisma gerencia as tabelas da aplicacao, como `teachers`. O schema `auth` continua sendo gerenciado pelo Supabase Auth.

Uso previsto:

- workers assíncronos;
- processamento de PDFs;
- compressão e normalização de arquivos;
- extração de texto;
- extração de questões;
- geração de embeddings;
- integrações com gateways de pagamento;
- tarefas agendadas.

No MVP, o backend pode começar simples e ser chamado pelo frontend/Next.js ou por jobs registrados no banco.

Estrutura futura sugerida:

```text
backend/
  workers/
    document-processor/
  packages/
    ai/
    payments/
    jobs/
```
# back_meumonitor
