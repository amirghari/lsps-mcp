# LSPS — Limited Stock Product System

A race-safe limited-drop platform: backend in **Fastify + TypeScript + Prisma + Postgres**, frontend in **Vite + React + TypeScript + TanStack Query**. Built for the scenario "100 users hitting Reserve on the last 10 units at the same millisecond — sell exactly 10, never 11, never 9".

> **Submission deliverables:**
> - GitHub: this repo
> - Pxxl deploy: _link added on submission_
> - Loom walkthrough (5–8 min): _link added on submission_
> - Architecture diagram: [`docs/architecture.md`](docs/architecture.md) — see also the ASCII version below
> - This README (race conditions, schema, trade-offs, 10k breakage, scaling)

---

## Table of contents

1. [What this is](#what-this-is)
2. [Quick start](#quick-start)
3. [Endpoints](#endpoints)
4. [Architecture overview](#architecture-overview)
5. [How race conditions were handled](#how-race-conditions-were-handled)
6. [Why certain schema decisions were made](#why-certain-schema-decisions-were-made)
7. [Trade-offs](#trade-offs)
8. [What would break at 10k concurrent users](#what-would-break-at-10k-concurrent-users)
9. [How I'd scale it](#how-id-scale-it)
10. [Testing](#testing)
11. [Project structure](#project-structure)
12. [Deploy notes](#deploy-notes)
13. [Future work](#future-work)

---

## What this is

A limited-stock "drop" system. Users hit **Reserve** on a product; the system locks one unit for them for **5 minutes**; they either **complete checkout** (becomes an Order) or **lose the reservation** (a background sweeper restores the unit to the available pool).

Two correctness invariants the system must never violate:

1. **`Product.stockAvailable` must never go negative** — i.e. no overselling, no matter how many concurrent reservers hit the same SKU.
2. **The InventoryLog ledger and the live stock counter must always reconcile** — i.e. every state change is durably recorded and auditable.

Both are enforced at the database layer (transactional updates + Postgres `CHECK` constraints) so application-layer bugs cannot silently corrupt inventory.

---

## Quick start

```bash
# 1. Install
pnpm install

# 2. Start local Postgres (host port 5433 — system Postgres often holds 5432)
pnpm db:up

# 3. First-time DB setup
cp .env.example .env
# set JWT_SECRET via: openssl rand -hex 32
pnpm db:migrate
pnpm db:seed   # seeds DROP-001 with stockTotal=50

# 4. Run both apps
pnpm dev       # api on :4000, web on :5173

# 5. Smoke
curl http://localhost:4000/health
curl http://localhost:4000/api/products
```

---

## Endpoints

Every error response uses one envelope: `{ "error": { "code", "message", "details" }, "requestId" }`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/health` | – | Liveness |
| `GET` | `/health/db` | – | DB readiness (Prisma `SELECT 1`) |
| `GET` | `/metrics` | – | Prometheus format, default Node metrics + 5 custom counters |
| `POST` | `/api/auth/register` | – | Create user, issue JWT |
| `POST` | `/api/auth/login` | – | Issue JWT |
| `GET` | `/api/auth/me` | JWT | Current user |
| `GET` | `/api/products` | – | Paged + filter (`search`, `available=true`) + sort (`createdAt`/`name`/`priceCents`/`stockAvailable`) |
| `GET` | `/api/products/:id` | – | Single product |
| `POST` | `/api/reserve` | JWT | `{ productId, quantity }` → reservation with 5-min TTL |
| `POST` | `/api/checkout` | JWT | `{ reservationId }` → Order |
| `GET` | `/api/reservations` | JWT | Caller's reservations, paged + filter on `status` / `productId` |
| `GET` | `/api/reservations/:id` | JWT | Ownership-checked |

**Status codes used:** `200` OK, `201` Created, `204` No Content, `400` validation, `401` unauthenticated, `403` cross-user, `404` not found, `409` business conflict (`OUT_OF_STOCK`, `DUPLICATE_RESERVATION`, `RESERVATION_ALREADY_USED`), `410` `RESERVATION_EXPIRED`, `429` rate-limited, `503` overload (under-pressure shedder).

---

## Architecture overview

```
┌────────────────┐      JWT       ┌─────────────────────────────┐
│  React (Vite)  │ ─────────────▶ │  Fastify API                │
│  Drop Page     │ ◀───────────── │  ├── /api/auth/*             │
│  TanStack Q    │   5s polling   │  ├── /api/products[/:id]     │
│                │                │  ├── /api/reserve            │
└────────────────┘                │  ├── /api/checkout           │
                                  │  ├── /api/reservations[/:id] │
                                  │  ├── /health, /health/db     │
                                  │  └── /metrics (prom)         │
                                  └──────────────┬──────────────┘
                                                 │ Prisma (READ COMMITTED + FOR UPDATE)
                                                 ▼
                                     ┌────────────────────────────┐
                                     │  Postgres 16               │
                                     │  ├── Product               │
                                     │  ├── Reservation           │
                                     │  ├── Order                 │
                                     │  ├── User                  │
                                     │  └── InventoryLog (ledger) │
                                     │  + CHECK stockAvailable≥0  │
                                     └────────────┬───────────────┘
                                                  ▲
                                     ┌────────────┴───────────────┐
                                     │ Expiry sweeper             │
                                     │  setInterval every 15s     │
                                     │  SKIP LOCKED → restore     │
                                     │  signed-delta ledger row   │
                                     └────────────────────────────┘
```

The fuller annotated version ([`docs/architecture.md`](docs/architecture.md)) shows the same picture with labels for the lock primitive, the InventoryLog double-entry invariant, and the sweeper's `SKIP LOCKED` interaction.

---

## How race conditions were handled

The classical bug: two reservers both read `stockAvailable = 1`, both pass the check, both decrement → sells 2 of 1.

Our fix is a **Postgres row-level exclusive lock** inside a Prisma `$transaction`, with a **defense-in-depth Postgres CHECK constraint** that physically rejects negative writes even if app logic regresses.

### The reserve transaction step-by-step

[`apps/api/src/services/reservations.ts:52-105`](apps/api/src/services/reservations.ts#L52-L105)

```sql
BEGIN;  -- isolation level: READ COMMITTED

1.  SELECT id, sku, "stockAvailable"
      FROM "Product"
     WHERE id = $1
     FOR UPDATE;             -- ★ exclusive row lock acquired

2.  IF stockAvailable < quantity THEN
      ROLLBACK;              -- → 409 OUT_OF_STOCK (no ledger row, no stock change)
    END IF;

3.  SELECT 1 FROM "Reservation"
     WHERE userId=$u AND productId=$p AND status='ACTIVE';
    IF found THEN
      ROLLBACK;              -- → 409 DUPLICATE_RESERVATION
    END IF;

4.  UPDATE "Product"
       SET "stockAvailable" = stockAvailable - $quantity
     WHERE id = $1;

5.  INSERT INTO "Reservation" (..., status, expiresAt)
       VALUES (..., 'ACTIVE', now() + interval '5 minutes');

6.  INSERT INTO "InventoryLog" (productId, userId, reservationId,
                                eventType, delta, stockAfter)
       VALUES ($p, $u, $r, 'RESERVE', -$quantity, $newStock);

COMMIT;                       -- ★ lock released
```

**Why this can never oversell:**

- Concurrent reservers of the same SKU **queue at step 1** on the row lock — they don't all read the same pre-decrement value.
- Postgres's row lock is exclusive: no two transactions can hold it on the same row simultaneously.
- The check (step 2) and the write (step 4) happen *under the same lock*, so by the time the loser gets the lock, it sees the winner's committed `stockAvailable`.
- Inventory updates and ledger inserts commit atomically. There is no window where the counter changed but the ledger didn't.

**Concurrent readers** (the frontend's `/api/products/:id` poll every 5s) pass through via Postgres MVCC and are **never blocked** by the lock. They see the previous committed snapshot until the txn commits.

### Defense in depth at the database layer

[`apps/api/prisma/migrations/20260528100000_stock_non_negative_check/migration.sql`](apps/api/prisma/migrations/20260528100000_stock_non_negative_check/migration.sql)

```sql
ALTER TABLE "Product"
  ADD CONSTRAINT "product_stock_available_non_negative"
  CHECK ("stockAvailable" >= 0);

ALTER TABLE "Product"
  ADD CONSTRAINT "product_stock_available_le_total"
  CHECK ("stockAvailable" <= "stockTotal");

ALTER TABLE "Reservation"
  ADD CONSTRAINT "reservation_quantity_positive" CHECK (quantity > 0);

ALTER TABLE "Order"
  ADD CONSTRAINT "order_quantity_positive"      CHECK (quantity > 0);
ALTER TABLE "Order"
  ADD CONSTRAINT "order_total_cents_non_negative" CHECK ("totalCents" >= 0);
```

If app code ever attempts a write that would violate these, **Postgres rejects the statement** — not at commit time, immediately. The application can't even silently corrupt inventory; the DB refuses.

### Checkout transaction (same lock discipline, different row)

[`apps/api/src/services/reservations.ts:175-230`](apps/api/src/services/reservations.ts#L175-L230)

```sql
BEGIN;
  SELECT id, userId, productId, quantity, status, expiresAt
    FROM "Reservation"
   WHERE id = $reservationId
   FOR UPDATE;

  -- Validate ownership + status + expiry under the lock
  IF userId   != $caller       THEN ROLLBACK; END IF; -- 403 FORBIDDEN
  IF expiresAt < now()         THEN ROLLBACK; END IF; -- 410 RESERVATION_EXPIRED
  IF status   != 'ACTIVE'      THEN ROLLBACK; END IF; -- 409 RESERVATION_ALREADY_USED

  INSERT INTO "Order"          (...) VALUES (...);
  UPDATE "Reservation" SET status='COMPLETED', completedAt=now() WHERE id=$r;
  INSERT INTO "InventoryLog"   (eventType='CHECKOUT', delta=0, stockAfter=...);
COMMIT;
```

Stock is NOT touched at checkout — it was already debited at reserve time. Checkout only converts the reservation into an Order and adds a ledger entry.

### Expiry sweeper (the most subtle part)

[`apps/api/src/services/expiry.ts`](apps/api/src/services/expiry.ts)

Runs in-process every `EXPIRY_SWEEP_INTERVAL_SECONDS` (default 15s). For each batch:

```sql
BEGIN;
  -- 1. Pick up to N expired ACTIVE reservations.
  --    SKIP LOCKED: if a row is currently locked by a concurrent checkout,
  --    skip it (don't block). The skipped row is reconsidered on the next tick.
  SELECT id, productId, userId, quantity
    FROM "Reservation"
   WHERE status='ACTIVE' AND expiresAt < now()
   ORDER BY expiresAt ASC, productId ASC
   LIMIT 100
   FOR UPDATE SKIP LOCKED;

  -- 2. Group by product; lock product rows in sorted UUID order
  --    (deterministic lock acquisition → no deadlock under multiple sweepers).
  FOR EACH productId IN sorted_unique_productIds LOOP
    SELECT "stockAvailable" FROM "Product" WHERE id=productId FOR UPDATE;
    UPDATE "Product" SET stockAvailable = stockAvailable + sum(qty);

    -- One RELEASE_EXPIRY ledger row per released reservation, with
    -- a running stockAfter so snapshots stay monotonic-correct.
    FOR EACH expired_reservation IN batch FOR THIS PRODUCT LOOP
      INSERT INTO "InventoryLog" (... 'RELEASE_EXPIRY', +qty, stockAfter_running);
    END LOOP;
  END LOOP;

  -- 3. Mark all batched reservations EXPIRED.
  UPDATE "Reservation" SET status='EXPIRED' WHERE id IN ($batch);
COMMIT;
```

Three properties:

- **Doesn't block users.** `SKIP LOCKED` means the sweeper steps over any reservation currently being checked out. The checkout finishes, the reservation either becomes COMPLETED (sweeper's `WHERE status='ACTIVE'` filter excludes it next tick) or stays ACTIVE (sweeper picks it up). Either way: correct.
- **Idempotent.** A crashed sweeper rolls back. Next tick reconsiders the same rows from a clean state.
- **Deadlock-free under multiple instances.** Product locks are always acquired in sorted order, so two sweepers can't grab product A→B and B→A simultaneously.

### Verified by the test suite

[`apps/api/tests/concurrency.test.ts`](apps/api/tests/concurrency.test.ts) fires **100 parallel reserve requests** at a product with `stockTotal=10` and asserts:

- Exactly **10 succeed** with `201`
- Exactly **90 fail** with `409 OUT_OF_STOCK`
- Final `stockAvailable === 0`
- Final InventoryLog has 10 RESERVE rows with `stockAfter` values strictly **monotonic 9 → 0**

If this test ever fails, the build doesn't ship.

---

## Why certain schema decisions were made

The schema lives at [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma). Each non-obvious choice has a reason.

### Two-column stock model on `Product` (`stockTotal` + `stockAvailable`)

| Column | Why |
|---|---|
| `stockTotal` (immutable) | Manufactured inventory count. Changes only via explicit `ADJUSTMENT` events. |
| `stockAvailable` (mutable, lock-protected) | Current sellable count, updated only inside the FOR-UPDATE-locked reserve transaction. |

**The alternative** would be a single `stockTotal` column and computing `stockAvailable = stockTotal - SUM(active reservations + completed orders)` on every product read. That works but:

- Every `GET /api/products/:id` becomes a JOIN + aggregate. On a read-heavy drop landing page polling every 5s, that's a hot path you don't want to spend CPU on.
- The two-column model is O(1) at the cost of one extra write per state transition.
- The ledger (`InventoryLog`) still lets you reconstruct the running balance if the live counter ever drifts, so you don't lose forensic ability.

### `Reservation.status` as a state machine, not a `deletedAt` timestamp

```
ACTIVE ──checkout──▶ COMPLETED  (terminal)
ACTIVE ──sweeper───▶ EXPIRED    (terminal)
ACTIVE ──manual────▶ CANCELLED  (terminal)
```

The sweeper queries `WHERE status='ACTIVE' AND expiresAt < now()`. A `deletedAt` model would mix "no longer relevant for current state" with "happened in the past", which makes both the sweeper query and the user's reservation-history view harder to express.

Indexes that drop out of this:

- `(status, expiresAt)` — the sweeper's hot path.
- `(userId, productId, status)` — the duplicate-reservation guard's exact lookup.
- `(userId, createdAt)` — the user's reservation list.

### `InventoryLog` is append-only with a signed `delta`

```
eventType         delta meaning
─────────────     ─────────────────────────────
RESERVE           negative (stock leaves the pool)
RELEASE_EXPIRY    positive (stock returns)
RELEASE_CANCEL    positive
CHECKOUT          zero    (no stock change at checkout — already debited)
ADJUSTMENT        signed  (manual operator action)
```

This means `SUM(delta) WHERE productId=X` reconstructs every change since the beginning. The `stockAfter` snapshot per row makes "what was stock right after this event?" answerable without a running window function.

**No `UPDATE` or `DELETE` is ever issued against InventoryLog.** In production we'd `REVOKE UPDATE, DELETE ON "InventoryLog" FROM <api_user>` so the API role *can't* mutate the ledger even by accident.

### Why no partial UNIQUE index on `(userId, productId) WHERE status='ACTIVE'`

A partial unique index would be the most idiomatic way to enforce "one ACTIVE reservation per user+product". We chose the in-transaction guard instead because:

1. **Prisma can't express partial uniques declaratively.** A raw migration would create schema-drift warnings on `prisma migrate dev`.
2. **The Product row lock already serializes us.** No other reserve transaction for this user+product can be inserting a row while we hold the lock, so a single `findFirst` inside the transaction is race-safe.
3. **Better error UX.** We throw `DUPLICATE_RESERVATION` with a meaningful message; a unique-violation surfaces as a generic Postgres SQLSTATE 23505 that the error handler would have to translate.

In a production hardening pass I would add the partial index too as belt-and-braces.

### Money as integer cents, never float

`priceCents INT`, `totalCents INT`. Decimal/float arithmetic on money is the classic "we lost $0.01 per transaction times a million" bug. Cents avoid it entirely and serialize cleanly through JSON.

### UUIDs for primary keys, not auto-increment

- Allows IDs to be generated client-side (and surfaced in the response *before* the DB row is committed).
- No "guess the next ID" attack surface.
- Mostly free in modern Postgres (`gen_random_uuid()` is fast).

### `metadata: Json?` on InventoryLog

So new event types can carry context (`{reasonCode: "operator_adjustment", note: "miscount"}`) without a schema migration. Cheap optionality.

---

## Trade-offs

| Decision | Alternative | Why we chose this |
|---|---|---|
| **Fastify** | Express, Koa | Faster, native TS types, built-in schema-based serialization, request lifecycle hooks (`preHandler`, `onResponse`) we use for metrics. |
| **Prisma** | Knex, TypeORM, raw `pg` | Required by spec. Generated typed client, painless migrations. Trade-off: had to drop to raw SQL for `FOR UPDATE` because Prisma's typed API doesn't expose it — but we wanted raw SQL there for clarity anyway. |
| **Pessimistic locking** (`FOR UPDATE`) | Optimistic with a version column + retry | At low contention optimistic wins (no lock-wait cost). Here we expect *high* contention — 100 reservers per SKU is the design target — and optimistic would retry 90% of attempts. Pessimistic queues without retries: one round-trip per reserver. |
| **READ COMMITTED + explicit row lock** | SERIALIZABLE isolation | SERIALIZABLE detects anomalies by *aborting* transactions; the app then retries. Under heavy contention that's hot-spinning. RC + explicit lock = serialize exactly the rows that need it. |
| **In-process `setInterval` sweeper** | `node-cron`, BullMQ, AWS EventBridge | Single process → equivalent. Easier to test, no extra dependency. Upgrade path is clean: extract the sweeper into a queue worker with leader election. |
| **`bcryptjs` (pure JS)** | native `bcrypt` | Portability — native bcrypt needs a build toolchain on every dev box and on the Pxxl deploy target. Trade-off: blocks the event loop under heavy login bursts; we precompute one shared hash in tests because that bursty fan-out tripped under-pressure. In production we'd put login behind rate limiting (already done — 60 req/min/IP) so per-request bcrypt cost is bounded. |
| **JWT (HS256, 24h TTL)** | session cookies + server-side store | Stateless — no Redis/cache requirement on the deploy target. Standard for SPA-on-CDN + API split. Trade-off: revocation requires either a denylist or short TTL. We picked 24h as a compromise; production would add refresh tokens. |
| **Signed-delta ledger** | Unsigned + direction column | Math is simpler (`SUM(delta)` reconstructs balance). One column instead of two. |
| **Cents (integer) for money** | Decimal / float | No rounding bugs, JSON-safe. |
| **Postgres CHECK constraints** | Rely on app code only | Belt-and-braces; cost ~nothing and make illegal writes structurally impossible. |
| **`@fastify/under-pressure` for load shedding** | No shedder; let requests pile up | The shedder returns `503` with `Retry-After` when the event loop falls behind by >2s. Better than uncontrolled latency. Health/metrics paths whitelisted so platform probes never see the 503. |
| **Monorepo (pnpm workspaces)** | Two repos, or single repo no workspace | Shared Zod schemas in `packages/types` eliminate "API said X, frontend expected Y" bugs. One PR per coherent change. |
| **Postgres on host port 5433 (in dev)** | Default 5432 | macOS dev boxes often have a Homebrew Postgres on 5432. Side-stepping the clash made onboarding deterministic. |
| **Local interval sweeper inside the API process** | Separate worker process | At this scale the simpler topology wins. At multi-node scale, the sweeper becomes a leader-elected job (or a queue-delayed-message). |

---

## What would break at 10k concurrent users

In order of how soon you'd hit each:

### 1. Prisma connection pool exhaustion (~hundreds of concurrent open transactions)

Default Prisma pool is around `num_physical_cpus * 2 + 1` (~20 on a typical box). Past that, new transactions queue and fail with `Timed out fetching a new connection` after `pool_timeout`. Symptom: 500s with that error string in the response.

### 2. Hot single-row lock contention (~hundreds of concurrent reservers on one SKU)

Every reserver serializes through the Product row's `FOR UPDATE` lock. If each reserver's critical section takes ~5ms (the queries plus the InventoryLog insert), then 10,000 reservers means the 10,000th waits ~50 seconds before its turn. The frontend's 8s API timeout would kill it long before. Effective throughput on a single SKU is ~200 reserves/sec, regardless of how big the box is.

### 3. Sweeper falls behind

With `EXPIRY_SWEEP_INTERVAL_SECONDS=15` and `batchSize=100`, the sweeper releases at most **400 reservations/min**. If 10,000 reservations expire within a minute (e.g. a panic-buy where most users abandon), the backlog grows by 9,600/min. Stock "stays sold out" longer than it should.

### 4. Event loop saturation

Every request runs:
- Fastify routing + lifecycle hooks
- JWT signature verification
- Zod schema validation
- Pino log serialization
- prom-client metric increment

At 100 req/s these are imperceptible. At 10k req/s we'd be CPU-bound in user-space JavaScript before we even touch the DB. The under-pressure shedder would correctly start returning 503s.

### 5. Pino log volume

One JSON log line per request at 10k req/s = ~3MB/sec of logs. Disk IOPS on the log sink (or whatever ships them to your aggregator) becomes a bottleneck. The fix is async batched shipping — easy, but worth naming.

### 6. Postgres write IOPS

Every reserve = 1 Product UPDATE + 1 Reservation INSERT + 1 InventoryLog INSERT = 3 row writes. At 10k reserves/sec that's 30k writes/sec, which puts you in "needs a beefier Postgres" territory. WAL writes also need fast disk.

### 7. Background-thread starvation under bcryptjs (login bursts)

A coordinated login burst (e.g. 1,000 users all signing in at once during a drop) would saturate the event loop on bcrypt hashing — pure-JS, no thread offload. Symptoms: every request, not just logins, slows down or 503s.

---

## How I'd scale it

Three staged answers, depending on how much budget and complexity you're willing to spend.

### Stage 1 — same architecture, bigger numbers (no design changes)

Cheap, fast, gets you to ~1k QPS:

- **Bump Prisma pool**: append `?connection_limit=100&pool_timeout=30` to `DATABASE_URL`.
- **Put PgBouncer in front of Postgres in transaction mode** — Node app holds many cheap logical connections, PgBouncer multiplexes them onto a small pool of real Postgres connections.
- **Read replicas for product reads.** `GET /api/products[/:id]` is the read-heavy path; route it to a hot standby. Writes still go to the primary.
- **Move the sweeper out of the API process.** Run it as a tiny dedicated worker, possibly multiple instances (the `SKIP LOCKED` + sorted-product-ID locking already support this).
- **Switch native `bcrypt` if the deploy target has the toolchain.** Hashing moves off the event loop onto libuv's threadpool.

### Stage 2 — split the hot SKU (single SKU becomes the bottleneck)

When one SKU dominates contention, divide it across multiple rows:

- **Shard inventory.** Replace one Product row with N "shards" of the same SKU (`stockAvailable_shard_0..9`, or a Variant table with N rows summing to `stockTotal`). Reservers hash to a shard. Lock contention divided by N.
- **Pre-mint reservation tickets.** Before the drop opens, INSERT `stockTotal` "ticket" rows. Reservers grab the next one via `SELECT … FROM tickets WHERE claimed=false FOR UPDATE SKIP LOCKED LIMIT 1`. Contention spreads across N rows automatically.

Both approaches turn "one lock serializing 10,000 reservers" into "10 locks each serializing ~1,000 reservers" — 10× the throughput.

### Stage 3 — queue-fronted reservation (linearize contention out of the request path)

For very-high-traffic drops, take the lock contention out of HTTP entirely:

- `POST /api/reserve` validates input and **enqueues** an intent onto a single-writer queue (Redis Streams / Kafka).
- The HTTP handler returns immediately with a "pending" ticket the client polls (or subscribes to via SSE/WebSocket).
- A small pool of workers drains the queue and executes the FOR UPDATE transaction in serial-ish fashion.
- Adds ~100ms of latency, but the HTTP API never blocks on locks — it just enqueues. The hot SKU goes from "10,000 reservers fighting one row lock" to "one worker draining one queue" — perfectly linear, fully observable.

### Operational layer (parallel to all three stages)

- **Prometheus + Grafana** scraping `/metrics`. Alerts that matter:
  - `histogram_quantile(0.95, lsps_http_request_duration_seconds_bucket{route="/api/reserve"}) > 1` for 2 minutes → lock contention rising
  - `rate(lsps_reservations_expired_total[5m]) > rate(lsps_reservations_checked_out_total[5m])` → people abandon faster than they buy
  - `rate(lsps_out_of_stock_rejections_total{product_sku=X}[1m]) > 100` → marketing signal: under-supplied
- **Postgres HA**: primary + 1 hot standby with automatic failover (Patroni / RDS Multi-AZ / Aurora).
- **Structured log aggregation**: ship Pino JSON to Loki / Cloud Logging / Datadog; correlate by `requestId`.

---

## Testing

The full suite is `pnpm test` from the repo root: **17 backend specs + 26 frontend specs = 43 tests**.

### Backend (`apps/api/tests/`)

- [`reservation.test.ts`](apps/api/tests/reservation.test.ts) — reserve happy path, dup-guard, out-of-stock rollback, auth, validation; checkout happy, double-checkout, cross-user, expired; sweeper restore, idempotency, TTL respect.
- [`concurrency.test.ts`](apps/api/tests/concurrency.test.ts) — **100-parallel single-SKU stress** (exactly 10 succeed on `stockTotal=10`, monotonic ledger 9→0), 50-parallel single-user (exactly 1 succeeds, 49 DUPLICATE), 40-parallel cross-SKU (no cross-contamination).

Tests target a separate `lsps_test` database so `TRUNCATE` is safe:

```bash
docker exec lsps-postgres psql -U lsps -d postgres \
  -c "CREATE DATABASE lsps_test OWNER lsps;"
cd apps/api && DATABASE_URL='postgresql://lsps:lsps_dev@localhost:5433/lsps_test?schema=public' \
  pnpm exec prisma migrate deploy
```

### Frontend (`apps/web/src/`)

- `hooks/useCountdown.test.tsx` — timer ticks down, transitions to expired at zero, stops scheduling after expiry, resets on new `expiresAt`.
- `api/client.test.ts` — Bearer attach, error envelope parsing, `ApiNetworkError` on fetch failure, `ApiTimeoutError` on abort, 204 No Content handling.
- `lib/errors.test.ts` — `OUT_OF_STOCK` → "sold out", `DUPLICATE_RESERVATION` → "already reserved", `RESERVATION_EXPIRED` → "expired", network → "offline", timeout → "slow", retryable flags, generic 5xx fallback.

---

## Project structure

```
LSPS-MCP/
├── apps/
│   ├── api/                        # Fastify + Prisma backend
│   │   ├── src/
│   │   │   ├── app.ts              # plugin wiring
│   │   │   ├── server.ts           # boot, signal handlers, start cron
│   │   │   ├── config.ts           # Zod-validated env loading
│   │   │   ├── plugins/            # config, prisma, metrics, errorHandler, auth
│   │   │   ├── routes/             # health, metrics, auth, products, reservations, checkout
│   │   │   ├── services/
│   │   │   │   ├── reservations.ts # reserve() + checkout() — read this first
│   │   │   │   └── expiry.ts       # sweepExpiredReservations() + startExpiryCron()
│   │   │   └── lib/                # AppError + bcrypt helpers
│   │   ├── prisma/                 # schema + migrations + seed
│   │   ├── tests/                  # reservation + concurrency tests
│   │   └── Dockerfile
│   └── web/                        # Vite + React + Tailwind frontend
│       ├── src/
│       │   ├── api/                # client + per-resource modules
│       │   ├── hooks/              # useAuth, useProduct, useCountdown, useReserve, useCheckout
│       │   ├── components/         # DropCard, CountdownBadge, LoginCard, etc.
│       │   ├── pages/DropPage.tsx
│       │   └── lib/errors.ts       # API error → user-facing message
│       └── Dockerfile
├── packages/
│   └── types/                      # shared Zod schemas
├── docker-compose.yml              # local dev Postgres
├── docker-compose.production.yml   # reference single-host prod compose
└── .env.example                    # dev env template
```

Where to look first when reviewing the code:

1. **The reservation transaction**: [`apps/api/src/services/reservations.ts`](apps/api/src/services/reservations.ts) — lines 52–105 are the whole project in 50 lines.
2. **The sweeper**: [`apps/api/src/services/expiry.ts`](apps/api/src/services/expiry.ts) — `SKIP LOCKED` + deterministic product lock order.
3. **The schema**: [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma) + the two migrations.
4. **The concurrency proof**: [`apps/api/tests/concurrency.test.ts`](apps/api/tests/concurrency.test.ts).

---

## Deploy notes

The repo ships two production Dockerfiles ([`apps/api/Dockerfile`](apps/api/Dockerfile), [`apps/web/Dockerfile`](apps/web/Dockerfile)) and a reference [`docker-compose.production.yml`](docker-compose.production.yml).

### Required environment variables (production)

See [`.env.production.example`](.env.production.example) for the full list. The non-obvious ones:

- `DATABASE_URL` — must include `?sslmode=require` for any internet-facing Postgres.
- `JWT_SECRET` — 32-byte hex (`openssl rand -hex 32`). Rotating this invalidates every issued token.
- `CORS_ORIGIN` — exact frontend URL(s), comma-separated. **Not** `*` in production.
- `PORT` — most PaaSes inject this; the API and the nginx-serving web image both honor it.

### Migration on deploy

The API Dockerfile's `CMD` runs `prisma migrate deploy` before starting the server. `migrate deploy` is the production-safe variant (idempotent, no interactive prompts, refuses to drift the schema).

### Build-time vs runtime env (frontend)

Vite **inlines** `VITE_API_URL` at build time — it's not a runtime variable. The web Dockerfile takes it as a build arg:

```bash
docker build --build-arg VITE_API_URL=https://api.your-host.app \
  -f apps/web/Dockerfile -t lsps-web .
```

---

## Future work

If we had another week:

- **Native bcrypt** with feature detection (fall back to bcryptjs if no toolchain).
- **Partial unique index** `(userId, productId) WHERE status='ACTIVE'` as a raw migration alongside the in-transaction guard.
- **Idempotency keys** on `/api/reserve` so a retried POST (network blip during a drop) can't accidentally double-reserve.
- **Refresh tokens** instead of 24h JWTs; per-device session revocation.
- **Sweeper extracted to a worker** with leader election (single-source-of-truth scheduler).
- **OpenTelemetry traces** correlated with the existing `requestId`.
- **E2E tests with Playwright** driving the deployed drop page through a simulated overselling attempt.
- **Per-SKU sharded inventory** to remove the single-row contention ceiling.

---

## License

This is a take-home assessment. Code is provided for review.
