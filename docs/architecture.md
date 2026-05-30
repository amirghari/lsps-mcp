# Architecture diagram — sketch guide

The submission requires an architecture diagram. The spec literally says "can be hand-drawn", and a hand-drawn one is often **more** memorable than another generic boxes-and-arrows render. Follow the layout below and you'll have a clear diagram in ~5 minutes.

When done, save it as `docs/architecture.png` (phone photo is fine — crop, brighten, drop it in).

---

## Layout — top to bottom, left to right

Use a landscape sheet of paper or whiteboard. Divide it into **3 horizontal bands**:

```
┌─────────────────────────────────────────────────────────────┐
│  BAND 1  —  CLIENT                                          │
├─────────────────────────────────────────────────────────────┤
│  BAND 2  —  API                                             │
├─────────────────────────────────────────────────────────────┤
│  BAND 3  —  DATA                                            │
└─────────────────────────────────────────────────────────────┘
```

The diagram tells the same story top-down: browser → API → database. The **single most important thing** to convey visually is the row lock between the API and the Product table — make it stand out.

---

## Band 1 — Client (one box, label only)

Draw one rectangle at top-left, label it:

```
  ┌──────────────────────────────────┐
  │  React (Vite + TS)               │
  │  Drop Page                       │
  │  TanStack Query (5 s polling)    │
  └──────────────┬───────────────────┘
                 │
                 │  HTTPS + JWT
                 │
                 ▼
```

The arrow goes down into Band 2.

---

## Band 2 — API (one big box with routes inside)

A larger rectangle in the middle band, labelled "Fastify API". Inside it, list the routes in two columns:

```
  ┌─────────────────────────────────────────────────────────┐
  │  Fastify 5  (Node 22 + TS)                              │
  │                                                          │
  │   ┌──────────────────┐    ┌──────────────────────────┐  │
  │   │ Auth & Products  │    │ Reserve / Checkout       │  │
  │   │  /api/auth/*     │    │  POST /api/reserve       │  │
  │   │  /api/products   │    │  POST /api/checkout      │  │
  │   │  /api/products/* │    │  GET  /api/reservations  │  │
  │   └──────────────────┘    └──────────────────────────┘  │
  │                                                          │
  │   ┌──────────────────────────────────────────────────┐   │
  │   │ Cross-cutting plugins                            │   │
  │   │  helmet · CORS · rate-limit · JWT · Pino · Zod   │   │
  │   │  prom-client (/metrics)  ·  under-pressure (503) │   │
  │   └──────────────────────────────────────────────────┘   │
  └───────┬─────────────────────────────────────┬───────────┘
          │                                     │
          │  Prisma                             │  Prisma
          │  $transaction                       │  $transaction
          │  + SELECT … FOR UPDATE              │  + SKIP LOCKED
          │                                     │
          ▼                                     ▼
```

Two arrows go down into Band 3 — one labelled with the reserve-side lock primitive, one with the sweeper-side. **This is the part that earns interview points; don't bury it.**

Also draw a small loop coming out of the API box (top-right) labelled `setInterval 15 s — expiry sweeper`. That arrow curves back into the box to indicate it runs *inside* the API process.

---

## Band 3 — Postgres (one box with five tables)

```
  ┌─────────────────────────────────────────────────────────┐
  │  Postgres 16                                             │
  │                                                          │
  │   ┌───────────┐  ┌─────────────┐  ┌─────────┐            │
  │   │ Product   │  │ Reservation │  │ Order   │            │
  │   │ stockTotal│  │ status      │  │ totalCts│            │
  │   │ stockAvail│  │ expiresAt   │  └─────────┘            │
  │   └─────┬─────┘  └──────┬──────┘                         │
  │         │ ★ row lock    │                                │
  │         │ FOR UPDATE    │                                │
  │   ┌─────▼─────┐  ┌──────▼──────┐                         │
  │   │  User     │  │InventoryLog │                         │
  │   │  email    │  │ delta       │  ◀── append-only        │
  │   │  pwHash   │  │ stockAfter  │     audit ledger        │
  │   └───────────┘  └─────────────┘                         │
  │                                                          │
  │   CHECK ("stockAvailable" >= 0)   ◀── defense in depth   │
  └─────────────────────────────────────────────────────────┘
```

**Mark these three things explicitly with arrows or asterisks:**

1. **The row lock** — a star or "★" next to the Product box with a label "FOR UPDATE row lock — serializes reservers".
2. **InventoryLog as append-only ledger** — write "append-only ledger" on it. Bonus: small annotation `SUM(delta) == stockAvailable - stockTotal` as the reconciliation invariant.
3. **CHECK constraint** — a horizontal line at the bottom of the Postgres box with the CHECK shown as DB-level guarantee.

---

## What to highlight if you can use color

If you've got two markers:

- **Black**: everything default
- **Red** (or a thicker line): the lock arrow from API → Product, the CHECK constraint, and the InventoryLog "append-only" label.

If you've got three:

- **Black**: default
- **Red**: lock + CHECK + ledger (the correctness story)
- **Blue**: sweeper loop + SKIP LOCKED arrow (the recovery story)

That visual separation makes the diagram readable at a glance.

---

## Alternatives if you'd rather render than hand-draw

The brief permits hand-drawn but doesn't require it. If you'd rather use a tool:

- **Excalidraw** (https://excalidraw.com/) — has a hand-drawn aesthetic, exports PNG. Fastest tool-based option.
- **draw.io / diagrams.net** — more formal "IT diagram" look.
- **Mermaid** in this repo's README (already supported by GitHub):

  ```mermaid
  flowchart TB
    subgraph Client
      W[React Drop Page<br/>5s polling]
    end
    subgraph API[Fastify API]
      R[POST /api/reserve]
      C[POST /api/checkout]
      M[/metrics, /health]
      X[setInterval 15s<br/>expiry sweeper]
    end
    subgraph DB[Postgres 16]
      P[(Product<br/>stockAvailable)]
      RES[(Reservation<br/>ACTIVE/EXPIRED/...)]
      O[(Order)]
      L[(InventoryLog<br/>append-only)]
      CHK[CHECK stockAvailable ≥ 0]
    end
    W -->|JWT| R
    W -->|JWT| C
    R -- "$transaction<br/>SELECT … FOR UPDATE" --> P
    R --> RES
    R --> L
    C --> RES
    C --> O
    C --> L
    X -- "SKIP LOCKED" --> RES
    X --> P
    X --> L
    P -.-> CHK
  ```

Either way, the diagram is one of three deliverables that anchors the interview conversation. Spend 5 minutes on it; don't over-engineer.

---

## Quick checklist before saving

- [ ] Browser at top, Postgres at bottom, API in the middle
- [ ] Five Postgres tables labeled (Product, Reservation, Order, User, InventoryLog)
- [ ] Arrow from API → Product labeled `SELECT … FOR UPDATE`
- [ ] Sweeper loop with `SKIP LOCKED`
- [ ] InventoryLog labeled "append-only"
- [ ] CHECK constraint shown as a DB-level guarantee
- [ ] Photo saved as `docs/architecture.png`
