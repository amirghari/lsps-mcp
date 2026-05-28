# LSPS — Limited Stock Product System

Race-safe limited-drop platform. Backend (Fastify + TypeScript + Prisma + Postgres) reserves limited inventory under a row-level lock so stock never goes negative; a 5-minute TTL plus a background sweeper reclaim unused reservations. Frontend (Vite + React + TypeScript + TanStack Query) is the live drop page.

> **Status:** Days 1–2 complete. Reservation flow, checkout, cron sweeper, full test suite (17/17 passing including a 100-parallel concurrency stress test) all green. Frontend drop page + deploy + Loom remaining.

## Layout

```
LSPS-MCP/
├── apps/
│   ├── api/         # Fastify API, Prisma, JWT auth, /metrics, cron sweeper, tests
│   └── web/         # Vite + React drop page (Day 3)
├── packages/
│   └── types/       # Shared Zod schemas (request/response DTOs)
├── docker-compose.yml   # Local Postgres 16 (host port 5433)
└── .env.example
```

## Quick start

```bash
# 1. Install
pnpm install

# 2. Start local Postgres (host port 5433 — system Postgres often holds 5432)
pnpm db:up

# 3. First-time DB setup
cp .env.example .env  # set JWT_SECRET to a 32-byte random string
pnpm db:migrate
pnpm db:seed

# 4. Run both apps
pnpm dev               # api on :4000, web on :5173

# 5. Smoke
curl http://localhost:4000/health
curl http://localhost:4000/api/products
```

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | – | Liveness probe |
| `GET` | `/health/db` | – | DB readiness probe |
| `GET` | `/metrics` | – | Prometheus metrics |
| `POST` | `/api/auth/register` | – | Create user, issue JWT |
| `POST` | `/api/auth/login` | – | Issue JWT |
| `GET` | `/api/auth/me` | JWT | Current user |
| `GET` | `/api/products` | – | Paged + filterable + sortable list |
| `GET` | `/api/products/:id` | – | Product detail |
| `POST` | `/api/reserve` | JWT | Reserve N units (5-min TTL) |
| `POST` | `/api/checkout` | JWT | Convert reservation → order |
| `GET` | `/api/reservations` | JWT | Caller's reservations, paged/filtered |
| `GET` | `/api/reservations/:id` | JWT | Reservation detail (ownership-checked) |

Every error response uses one envelope: `{ "error": { "code", "message", "details" }, "requestId" }`.

## Tests

```bash
# Tests run against a separate database lsps_test (already created during setup).
# To create from scratch on a new machine:
docker exec lsps-postgres psql -U lsps -d postgres -c "CREATE DATABASE lsps_test OWNER lsps;"
cd apps/api && DATABASE_URL='postgresql://lsps:lsps_dev@localhost:5433/lsps_test?schema=public' \
  pnpm exec prisma migrate deploy

# Run
pnpm --filter @lsps/api test
```

17 tests across two files:

- **`tests/reservation.test.ts`** — reserve happy path with ledger write; out-of-stock (txn rolled back, no ledger row); duplicate-reservation guard; second reservation allowed after checkout; auth + validation paths; checkout happy + double-checkout + cross-user + expired; expiry sweeper restores stock + writes RELEASE_EXPIRY; sweeper is idempotent.
- **`tests/concurrency.test.ts`** —
  - 100 parallel reserves on stockTotal=10 → **exactly** 10 succeed, 90 OUT_OF_STOCK, final stock=0, ledger snapshots monotonic 9→0.
  - 1 user firing 50 parallel reserves → **exactly** 1 succeeds, 49 DUPLICATE_RESERVATION.
  - 40 parallel reserves split across 2 SKUs → 5 succeed per SKU, no cross-contamination.

## How race conditions are handled

`POST /api/reserve` (see [`apps/api/src/services/reservations.ts`](apps/api/src/services/reservations.ts)):

1. Open `prisma.$transaction` at READ COMMITTED.
2. **Lock the Product row** with raw SQL: `SELECT id, sku, "stockAvailable" FROM "Product" WHERE id = $1 FOR UPDATE`. Concurrent reservers of the same SKU queue here; reservers of different SKUs never block each other.
3. **Re-read stock under the lock** — values seen outside the lock are stale.
4. Reject if `stockAvailable < quantity` (`409 OUT_OF_STOCK`, txn rolled back, no ledger row).
5. **Duplicate-reservation guard**: reject if an `ACTIVE` reservation already exists for `(userId, productId)` (`409 DUPLICATE_RESERVATION`).
6. Decrement stock, insert Reservation, append signed `InventoryLog` row (`delta = -quantity`, `stockAfter` snapshot). All three writes commit atomically.

`POST /api/checkout` locks the **Reservation** row (the resource being mutated), validates ownership + status + expiry under the lock, creates the Order, marks the reservation `COMPLETED`, and appends a `CHECKOUT` ledger row. The expiry sweeper (`SELECT … FOR UPDATE SKIP LOCKED`) never blocks live checkouts.

**Defense in depth:** the migration `20260528100000_stock_non_negative_check` adds Postgres CHECK constraints (`stockAvailable >= 0`, `stockAvailable <= stockTotal`, `quantity > 0`). Even if application logic had a bug, the DB would reject illegal writes.

## Architecture rationale (Day 4 README will expand)

- **Two-column stock model** (`stockTotal` immutable + `stockAvailable` mutable) keeps reads O(1) and avoids materializing reservation counts on every product fetch. The ledger (`InventoryLog`) makes the running balance reconstructible from events alone — useful for forensics.
- **In-process `setInterval` sweeper** instead of a distributed scheduler — single process is fine for one box. At multi-node scale, the sweeper moves to a queue worker (BullMQ/SQS).
- **Will be detailed on Day 4:** trade-offs, what breaks at 10k concurrent users, how to scale (per-SKU sharded counters, Redis distributed locks, queue-fronted reservation pipeline).
