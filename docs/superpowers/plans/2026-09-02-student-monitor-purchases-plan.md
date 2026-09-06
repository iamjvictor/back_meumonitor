# Student Monitor Purchases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a backend-authoritative simulated Stripe checkout that records student purchases and unlocks monitor subscriptions safely and idempotently.

**Architecture:** Add purchase order and item tables, keep `student_subscriptions` as the current-access projection, and expose authenticated backend endpoints for creating and confirming simulated checkouts. The frontend checkout becomes a thin client that sends monitor IDs and receives backend-calculated checkout data; it never decides price or access.

**Tech Stack:** Next.js 16, React 19, Fastify, Prisma 7, PostgreSQL/Supabase, TypeScript, Node test runner.

**Spec:** `backend/docs/superpowers/specs/2026-09-02-student-monitor-purchases-design.md`

## Global Constraints

- Only `PAID` purchases may activate access.
- Prices are calculated and validated in the backend in integer cents; frontend prices are untrusted display data.
- Simulated payment is enabled only with explicit `PAYMENTS_SIMULATION_ENABLED=true`.
- Repeated idempotency keys and repeated confirmations must not duplicate purchases or subscriptions.
- Do not store card numbers, CVV, payment credentials, or secrets.
- Preserve legacy `student_subscriptions` rows while adding nullable purchase linkage.
- Do not integrate Stripe or make external payment calls in this iteration.

### Task 1: Purchase persistence model and migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_add_student_purchases/migration.sql`
- Test: `backend/src/repositories/__tests__/student-purchase.repository.test.ts`

**Interfaces:**
- Produces Prisma models `StudentPurchase` and `StudentPurchaseItem`.
- Produces purchase status/payment method enums or equivalent database-safe values.
- Extends `StudentSubscription` with nullable `purchaseId`, gateway subscription metadata, current period fields and cancellation fields.

- [ ] Write failing repository/model contract tests for purchase-item uniqueness, integer amounts, and subscription linkage.
- [ ] Run the focused tests and verify they fail because the models do not exist.
- [ ] Add the Prisma models, relations, indexes, uniqueness constraints and migration SQL without changing unrelated tables.
- [ ] Regenerate Prisma client and run the focused tests.
- [ ] Run `prisma validate` and `prisma format`.

### Task 2: Backend purchase service and authenticated endpoints

**Files:**
- Create: `backend/src/models/student-purchase.model.ts`
- Create: `backend/src/repositories/student-purchase.repository.ts`
- Create: `backend/src/services/student-purchase.service.ts`
- Create: `backend/src/controllers/student-purchase.controller.ts`
- Create: `backend/src/routes/student-purchase.routes.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/src/config/env.ts`
- Modify: `backend/.env.example`
- Test: `backend/src/services/__tests__/student-purchase.service.test.ts`

**Interfaces:**
- `POST /api/v1/student/purchases` accepts `{ monitorIds: string[], paymentMethod: 'PIX'|'CREDIT_CARD'|'BOLETO'|'OTHER' }` and `Idempotency-Key`.
- `POST /api/v1/student/purchases/:purchaseId/simulated-checkout` returns a short-lived simulated session only when simulation is enabled.
- `POST /api/v1/student/purchases/:purchaseId/simulated-confirmation` validates the authenticated student, session, ownership, expiry, status, calculated amount and idempotency before activating subscriptions.
- `GET /api/v1/student/purchases` lists only the authenticated student's purchases.
- `GET /api/v1/student/subscriptions` lists only active subscriptions for the authenticated student.

- [ ] Write failing tests for unauthenticated access, unpublished monitors, client-price tampering, duplicate monitor IDs, existing active subscriptions, idempotency, expired sessions and repeated confirmation.
- [ ] Run the tests and confirm the expected failures.
- [ ] Implement backend validation and transaction boundaries; derive student identity from `request.user`, never from request body.
- [ ] Implement purchase creation with backend price lookup and item snapshots.
- [ ] Implement simulated session creation with random opaque ID, expiry, purchase/student binding and no payment secrets.
- [ ] Implement simulated confirmation that marks the purchase paid and upserts one active subscription per monitor in one transaction.
- [ ] Implement read endpoints with ownership filters and safe public monitor fields.
- [ ] Run focused unit/service tests and API contract tests.
- [ ] Run typecheck and lint for changed backend files.

### Task 3: Frontend simulated checkout integration

**Files:**
- Modify: `frontend/src/app/(student-app)/checkout/page.tsx`
- Modify: `frontend/src/app/(student-app)/areadoaluno/page.tsx`
- Test: manual browser flow plus any existing frontend checks.

**Interfaces:**
- Checkout sends only monitor IDs and payment method to the backend.
- Checkout displays backend-returned amounts and simulated Stripe-style payment UI.
- Confirmation calls the backend and redirects to `/areadoaluno` only after a successful `PAID` response.

- [ ] Replace the local `setTimeout` approval with backend calls.
- [ ] Add explicit simulated-checkout state, loading, failure and success states.
- [ ] Never send or trust frontend price, student ID or subscription status.
- [ ] Keep the UI clearly labeled as simulated/test mode.
- [ ] Ensure empty cart, expired session and already-confirmed purchase are handled without false success.
- [ ] Run frontend lint for changed files and manually verify the checkout flow.

### Task 4: Integration verification and hardening

**Files:**
- Modify only files required by failing integration tests.
- Test: backend focused tests, frontend typecheck/build, database migration validation.

- [ ] Verify schema/migration against a disposable or local database where available.
- [ ] Verify duplicate confirmation leaves exactly one paid purchase and one active subscription per student/monitor.
- [ ] Verify a student cannot read or confirm another student's purchase.
- [ ] Verify `/areadoaluno` uses `/api/v1/student/subscriptions` when real data wiring is enabled.
- [ ] Run all relevant backend tests and frontend checks, recording pre-existing failures separately.
- [ ] Review the final diff for secrets, client-controlled money, missing ownership filters and accidental unrelated edits.
