# LSPS — Limited Stock Product System

Race-safe limited-drop platform. Backend (Fastify + TypeScript + Prisma + Postgres) reserves limited inventory under a row-level lock so stock never goes negative; a 5-minute TTL plus a background sweeper reclaim unused reservations. Frontend (Vite + React + TypeScript + TanStack Query) is the live drop page.

> **Status:** Day 1 scaffold complete. Reservation/checkout business logic, cron sweeper, tests, frontend wiring, deploy + Loom land on Days 2–4.

## Layout

```
LSPS-MCP/
├── apps/
│   ├── api/         # Fastify API, Prisma, JWT auth, /metrics, cron sweeper
│   └── web/         # Vite + React drop page
├── packages/
│   └── types/       # Shared Zod schemas (request/response DTOs)
├── docker-compose.yml   # Local Postgres 16
└── .env.example
```

## Quick start

```bash
# 1. Install
pnpm install

# 2. Start local Postgres
pnpm db:up

# 3. First-time DB setup
cp .env.example .env  # set JWT_SECRET to a 32-byte random string
pnpm db:migrate
pnpm db:seed

# 4. Run both apps
pnpm dev               # api on :4000, web on :5173

# Smoke
curl http://localhost:4000/health
curl http://localhost:4000/health/db
curl http://localhost:4000/metrics
```

## Key endpoints (planned)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | – | Liveness probe |
| `GET` | `/health/db` | – | DB readiness probe |
| `GET` | `/metrics` | – | Prometheus metrics |
| `POST` | `/api/auth/register` | – | Create user |
| `POST` | `/api/auth/login` | – | Issue JWT |
| `GET` | `/api/products` | – | List, paged + filterable |
| `GET` | `/api/products/:id` | – | Product detail |
| `POST` | `/api/reserve` | JWT | Reserve N units (5-min TTL) |
| `POST` | `/api/checkout` | JWT | Convert reservation → order |

## Architecture rationale (preview — full version on Day 4)

**Race-safety.** `POST /reserve` opens a Prisma `$transaction` and locks the target Product row with `SELECT … FOR UPDATE`. Concurrent reservers of the same SKU serialize there; stock is re-read under the lock, decremented, and a `Reservation` + `InventoryLog` are inserted atomically. Overselling is structurally impossible regardless of HTTP concurrency.

**Audit trail.** Every stock movement (reserve, expiry release, cancel release, checkout) writes a signed-`delta` row to `InventoryLog` with `stockAfter` snapshot. The full ledger is reconstructible from the log alone — useful for forensics if stock ever drifts.

**Expiry.** A `node-cron` sweeper runs every `EXPIRY_SWEEP_INTERVAL_SECONDS` (default 15s) and processes batches of expired ACTIVE reservations with `SELECT … FOR UPDATE SKIP LOCKED`, so it never blocks live reservers.

**Will be detailed on Day 4:** trade-offs (in-process cron vs distributed scheduler, single-DB vs sharded), what breaks at 10k concurrent users (lock contention, connection pool, write IOPS), and how to scale (per-SKU sharded counters, Redis distributed locks, queue-fronted reservation pipeline).
