import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildTestApp,
  createProduct,
  createUser,
  getStock,
  postJson,
  resetDb,
} from "./helpers.js";

interface ReserveBody {
  reservationId: string;
  quantity: number;
}
interface ApiErrorBody {
  error: { code: string; message: string };
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDb(app);
});

describe("reserve under concurrent load", () => {
  it(
    "fires 100 parallel reserves at a product with stockTotal=10 → exactly 10 succeed, stock never goes negative",
    async () => {
      const product = await createProduct(app, {
        sku: "STRESS-01",
        stockTotal: 10,
      });

      // 100 distinct users (each can hold one ACTIVE reservation for this SKU).
      const users = await Promise.all(
        Array.from({ length: 100 }, () => createUser(app)),
      );

      // Fire all 100 reserve calls in parallel.
      const responses = await Promise.all(
        users.map((u) =>
          postJson<ReserveBody | ApiErrorBody>(
            app,
            "/api/reserve",
            { productId: product.id, quantity: 1 },
            u.token,
          ),
        ),
      );

      const successes = responses.filter((r) => r.statusCode === 201);
      const outOfStock = responses.filter(
        (r) =>
          r.statusCode === 409 &&
          (r.body as ApiErrorBody).error.code === "OUT_OF_STOCK",
      );
      const others = responses.filter(
        (r) => r.statusCode !== 201 && r.statusCode !== 409,
      );

      // Hard invariants:
      expect(successes.length).toBe(10);
      expect(outOfStock.length).toBe(90);
      expect(others.length).toBe(0);

      // Final stock state.
      const stock = await getStock(app, product.id);
      expect(stock).toBe(0);
      expect(stock).toBeGreaterThanOrEqual(0); // never negative

      // Audit ledger matches.
      const logs = await app.prisma.inventoryLog.findMany({
        where: { productId: product.id, eventType: "RESERVE" },
        orderBy: { createdAt: "asc" },
      });
      expect(logs).toHaveLength(10);
      expect(logs.every((l) => l.delta === -1)).toBe(true);
      // stockAfter snapshots must be strictly monotonic-decreasing 9..0.
      expect(logs.map((l) => l.stockAfter)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);

      // Reservation row count agrees.
      const reservations = await app.prisma.reservation.count({
        where: { productId: product.id, status: "ACTIVE" },
      });
      expect(reservations).toBe(10);
    },
    60_000,
  );

  it(
    "a single user firing 50 parallel reserves only ever wins one (duplicate-reservation guard)",
    async () => {
      const product = await createProduct(app, {
        sku: "STRESS-02",
        stockTotal: 50,
      });
      const user = await createUser(app);

      const responses = await Promise.all(
        Array.from({ length: 50 }, () =>
          postJson<ReserveBody | ApiErrorBody>(
            app,
            "/api/reserve",
            { productId: product.id, quantity: 1 },
            user.token,
          ),
        ),
      );

      const successes = responses.filter((r) => r.statusCode === 201);
      const dups = responses.filter(
        (r) =>
          r.statusCode === 409 &&
          (r.body as ApiErrorBody).error.code === "DUPLICATE_RESERVATION",
      );

      expect(successes.length).toBe(1);
      expect(dups.length).toBe(49);

      const stock = await getStock(app, product.id);
      expect(stock).toBe(49); // exactly 1 reserved
    },
    60_000,
  );

  it(
    "concurrent reserves across two SKUs do not cross-contaminate stock",
    async () => {
      const skuA = await createProduct(app, { sku: "AAA", stockTotal: 5 });
      const skuB = await createProduct(app, { sku: "BBB", stockTotal: 5 });

      const users = await Promise.all(
        Array.from({ length: 40 }, () => createUser(app)),
      );

      const responses = await Promise.all(
        users.map((u, i) =>
          postJson<ReserveBody | ApiErrorBody>(
            app,
            "/api/reserve",
            {
              productId: i % 2 === 0 ? skuA.id : skuB.id,
              quantity: 1,
            },
            u.token,
          ),
        ),
      );

      const successes = responses.filter((r) => r.statusCode === 201).length;
      expect(successes).toBe(10); // 5 per SKU

      expect(await getStock(app, skuA.id)).toBe(0);
      expect(await getStock(app, skuB.id)).toBe(0);
    },
    60_000,
  );
});
