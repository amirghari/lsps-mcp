# CLAUDE.md — guidance for AI agents working on this repo

This file is auto-loaded by Claude Code. Read it first; it captures hard-won context that isn't obvious from grep.

## What this project is

LSPS — Limited Stock Product System. **MPC / "Team Mensa" Full Stack Intern take-home assessment.** Submission deadline: ~2026-06-01 (4 days from 2026-05-28).

Deliverables the spec requires:
- GitHub link (this repo: `github.com/amirghari/lsps-mcp`, currently private)
- Pxxl deploy (https://pxxl.app/) — backend + frontend, **must not have downtime → automatic disqualification**
- README explaining: race conditions handled, schema rationale, trade-offs, what breaks at 10k users, scaling plan
- Loom video, 5–8 minutes
- Architecture diagram (hand-drawn OK)

The actual spec lives in an auth-walled SharePoint doc; only screenshots from chat history capture the requirements verbatim.

## Status (updated 2026-05-28 end of Day 2)

| Day | Scope | Status |
|---|---|---|
| 1 | Monorepo scaffold, Prisma schema, Fastify skeleton, health/metrics/auth/error envelope | ✅ committed `89b9130`, `363aadf` |
| 2 | Race-safe reserve/checkout, cron expirer, InventoryLog ledger, CHECK constraints, 17-test suite incl. 100-parallel stress | ✅ committed `15750e1` |
| 3 | Frontend drop page (useStock 5s poll, useReservation, useCountdown, edge cases, tests) | ⏳ next |
| 4 | Pxxl deploy, full README, Loom script, architecture diagram | ⏳ |

Reservation/concurrency logic is **complete and tested**. Don't refactor it without a strong reason — the FOR UPDATE strategy and the InventoryLog signed-delta + stockAfter invariant are the project's defensible centerpiece. Future sessions, focus on Day 3/4 unless explicitly asked.

## Architecture in one screen

```
apps/api    Fastify 5 + Prisma 6 + Pino + Zod + JWT + @fastify/{cors,helmet,rate-limit,under-pressure}
apps/web    Vite + React 18 + Tailwind + TanStack Query (Day 3 placeholder for now)
packages/types   Zod schemas shared between api validation and web typing
```

**Core invariant:** `Product.stockAvailable` only changes inside a `$transaction` that holds a `SELECT … FOR UPDATE` on the Product row. Postgres CHECK constraints enforce `stockAvailable >= 0` as a backstop. Every stock-affecting event also writes one row to `InventoryLog` with a signed `delta` and a `stockAfter` snapshot, so the ledger reconstructs the running balance from events alone.

**Where to look:**
- Reserve flow: [apps/api/src/services/reservations.ts](apps/api/src/services/reservations.ts) — `reserve()` for the lock dance, `checkout()` for the order conversion.
- Expiry sweeper: [apps/api/src/services/expiry.ts](apps/api/src/services/expiry.ts) — `SKIP LOCKED`, per-product stock restore.
- Migrations: [apps/api/prisma/migrations/](apps/api/prisma/migrations/) — `_init` then `_stock_non_negative_check` (CHECK constraints).
- Tests: [apps/api/tests/reservation.test.ts](apps/api/tests/reservation.test.ts), [apps/api/tests/concurrency.test.ts](apps/api/tests/concurrency.test.ts).
- Shared DTOs: [packages/types/src/index.ts](packages/types/src/index.ts).

## Quick start

```bash
pnpm install
pnpm db:up                  # docker compose, Postgres 16 on host :5433
cp .env.example .env        # set JWT_SECRET to a 32-byte hex
pnpm db:migrate
pnpm db:seed                # seeds DROP-001 with stockTotal=50

pnpm dev                    # api :4000, web :5173
pnpm --filter @lsps/api test   # 17 tests, ~7s end-to-end
```

## Environment quirks (these cost time to rediscover)

1. **System Postgres on `:5432`.** The dev box has Homebrew `postgresql@16` running on `:5432`. Our docker-compose Postgres is on **`:5433`** to avoid the clash. If a connection fails with `P1010 role denied`, the first check is `lsof -nP -iTCP:5432 -sTCP:LISTEN` — you may be hitting the wrong Postgres.
2. **`~/Desktop/.git` is unrelated.** Stale repo from a prior project (deleted React/TS app). Our git root is `~/Desktop/LSPS-MCP/.git`. Don't run destructive git in the parent.
3. **Root `.env` is shared by api + web.** Prisma CLI doesn't auto-find it from `apps/api/`, so scripts go through `dotenv-cli -e ../../.env --`. `src/config.ts` does the same trick at runtime so `tsx` finds env regardless of CWD.

## Test gotchas (re-learned the hard way on Day 2)

### `@fastify/under-pressure` returns 503 for in-process concurrency

A test that fires 100 parallel `app.inject(...)` calls gets back `503:INTERNAL` for every single one. Looks like a bug; it isn't. The plugin measures **event-loop *delay*** (not blocking), and 100+ in-process inject calls queue enough async work that successive ticks come around ≥1s late — exactly what `maxEventLoopDelay: 1000` is supposed to shed.

**Resolution:** In [apps/api/src/app.ts](apps/api/src/app.ts) the plugin is registered only when `app.config.NODE_ENV !== "test"`. This is the right tradeoff — under-pressure is *correct production behavior*; the tests are exercising the reservation transaction semantics, not the load shedder. If we ever want to test the shedder itself, do it in a *separate* test file.

### `bcryptjs` burns the event loop

A test that creates 100 users via `Promise.all(Array(100).map(createUser))` grinds and downstream requests in the same suite return 503 or time out — because `bcryptjs` is pure JS (no native binding) so 100 parallel `hash()` calls block the event loop.

**Resolution:** [apps/api/tests/helpers.ts](apps/api/tests/helpers.ts) `createUser` precomputes a single shared bcrypt hash and reuses it. Tests mint JWTs directly via `app.jwt.sign`, so the password-verification path isn't exercised. If we ever switch to native `bcrypt`, this hack can be reverted — but be aware native bcrypt needs a build step on the Pxxl deploy target.

## Conventions worth respecting

- One commit per coherent change; never amend pushed commits.
- Co-authored-by trailer on Claude-assisted commits: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- `.claude/` (per-developer Claude Code settings) is gitignored — don't commit it.
- Repo is **private** by default; flip to public via `gh repo edit amirghari/lsps-mcp --visibility public` only when ready for reviewer eyes (likely on Day 4 before submission).
