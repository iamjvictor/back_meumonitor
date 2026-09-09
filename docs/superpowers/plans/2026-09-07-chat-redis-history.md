# Chat Redis History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement temporary chat history in Redis with a sliding five-hour TTL and up to 20 student messages plus 20 assistant responses.

**Architecture:** The API will use a dedicated ioredis connection for chat history while BullMQ keeps its existing queue connections. Authorization will remain mandatory before every read, write, and delete. Messages will be stored chronologically under a scoped Redis key and trimmed to 40 records.

**Tech Stack:** TypeScript, Fastify, ioredis, BullMQ, Node test runner, tsx, Zod.

**Spec:** `docs/superpowers/specs/2026-09-07-chat-redis-history.md`

## Global Constraints

- Redis URL comes from `REDIS_URL` and is validated in `src/config/env.ts`.
- Chat keys must use the `chat:history:v1:` namespace.
- BullMQ keys and queue behavior must not be modified by chat history operations.
- The TTL is `18000` seconds and is renewed only on accepted student messages, final assistant responses, and future streaming progress.
- The maximum history context is 40 chronological messages.
- The backend must derive `studentId` from the authenticated session.
- No PostgreSQL persistence is part of this implementation.

---

### Task 1: Define Redis history contracts

**Files:**
- Create: `src/modules/chat/ports/chat-history.port.ts`
- Create: `src/modules/chat/models/chat-history.model.ts`
- Test: `src/modules/chat/models/__tests__/chat-history.model.test.ts`

**Interfaces:**

```ts
export type ChatHistoryRole = 'student' | 'assistant' | 'system';

export type ChatHistoryScope = {
  studentId: string;
  monitorId: string;
  subjectId: string;
};

export type ChatHistoryMessage = {
  id: string;
  role: ChatHistoryRole;
  content: string;
  createdAt: string;
};

export interface ChatHistoryPort {
  append(scope: ChatHistoryScope, message: ChatHistoryMessage): Promise<void>;
  list(scope: ChatHistoryScope): Promise<ChatHistoryMessage[]>;
  clear(scope: ChatHistoryScope): Promise<void>;
}
```

- [ ] **Step 1: Write failing schema tests** for valid roles, ISO timestamps, non-empty IDs, and non-empty content.
- [ ] **Step 2: Run the focused test** with `node --import tsx --test src/modules/chat/models/__tests__/chat-history.model.test.ts` and confirm it fails before the schema exists.
- [ ] **Step 3: Implement the model schema** with the approved 4,000-character message limit.
- [ ] **Step 4: Run the focused test** and confirm it passes.

### Task 2: Implement Redis adapter with sliding TTL

**Files:**
- Create: `src/modules/chat/repositories/redis-chat-history.repository.ts`
- Test: `src/modules/chat/repositories/__tests__/redis-chat-history.repository.test.ts`
- Modify: `package.json` to include the focused test in `test:chat`.

**Interfaces:**

- Constructor accepts an injectable ioredis-compatible client and defaults to a new connection using `env.REDIS_URL` in the production composition root.
- `append` serializes the message, executes `RPUSH`, `LTRIM key -40 -1`, and `EXPIRE key 18000`.
- `list` executes `LRANGE key 0 -1`, parses JSON, and returns chronological order.
- `clear` executes `DEL key`.

- [ ] **Step 1: Write failing tests** for key construction, append/trim/expire, chronological list, clear, and independent scopes.
- [ ] **Step 2: Run focused repository tests** and confirm the adapter is missing.
- [ ] **Step 3: Implement the adapter** with the exact key format `chat:history:v1:{studentId}:{monitorId}:{subjectId}`.
- [ ] **Step 4: Run focused repository tests** and confirm all Redis command assertions pass.
- [ ] **Step 5: Run `npm run test:chat`** to ensure existing chat tests remain green.

### Task 3: Integrate history into the message use case

**Files:**
- Modify: `src/modules/chat/services/chat.service.ts`
- Modify: `src/modules/chat/chat.module.ts`
- Test: `src/modules/chat/services/__tests__/chat.service.test.ts`

**Interfaces:**

- `ChatService` receives `ChatHistoryPort` as a dependency.
- Before generation, it reads up to 40 messages for the authorized scope.
- It appends the student message before generation.
- It appends the assistant message only after a successful final generation.
- It does not persist history when authorization fails.

- [ ] **Step 1: Extend the in-memory test double** to implement `ChatHistoryPort`.
- [ ] **Step 2: Write failing tests** for reading 40 messages, appending both roles, and leaving the student message available after generation failure.
- [ ] **Step 3: Implement the service integration** without changing the public authorization contract.
- [ ] **Step 4: Run `npm run test:chat`** and confirm the use-case tests pass.

### Task 4: Add read and clear endpoints

**Files:**
- Modify: `src/modules/chat/chat.routes.ts`
- Test: `src/modules/chat/__tests__/chat.routes.test.ts`

**Interfaces:**

```text
GET    /api/v1/student/monitors/:monitorId/chat/subjects/:subjectId/messages
DELETE /api/v1/student/monitors/:monitorId/chat/subjects/:subjectId/messages
```

- [ ] **Step 1: Write failing route tests** for authenticated access, unauthorized monitor, authorized list, and authorized clear.
- [ ] **Step 2: Implement the GET route** with authorization before Redis access and a maximum response of 40 messages.
- [ ] **Step 3: Implement the DELETE route** with authorization before `DEL`.
- [ ] **Step 4: Run route tests and `npm run typecheck`**.

### Task 5: Verify Redis coexistence and operational limits

**Files:**
- Modify: `src/modules/chat/README.md`
- Modify: `.env.example` with chat history defaults if environment overrides are introduced.

- [ ] **Step 1: Add a test** proving chat keys use `chat:history:v1:` and never invoke BullMQ queue keys or destructive Redis commands.
- [ ] **Step 2: Run `npm run test:chat`, `npm run typecheck`, and `npm run build`**.
- [ ] **Step 3: Verify the local Redis key manually** with `redis-cli --scan --pattern 'chat:history:v1:*'` while sending a test message.
- [ ] **Step 4: Document that the same Redis instance is acceptable for V1 and that a separate instance is the scaling path.**
