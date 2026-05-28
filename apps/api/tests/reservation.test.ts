import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { sweepExpiredReservations } from "../src/services/expiry.js";
import {
  buildTestApp,
  createProduct,
  createUser,
  getJson,
  getStock,
  postJson,
  resetDb,
} from "./helpers.js";

interface ReserveBody {
  reservationId: string;
  productId: string;
  quantity: number;
  expiresAt: string;
  status: string;
}
interface ApiErrorBody {
  error: { code: string; message: string };
}
interface OrderBody {
  orderId: string;
  reservationId: string;
  totalCents: number;
}
interface ReservationListBody {
  items: Array<{ id: string; status: string }>;
  total: number;
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

describe("POST /api/reserve", () => {
  it("reserves stock and emits an InventoryLog row", async () => {
    const product = await createProduct(app, { stockTotal: 5 });
    const user = await createUser(app);

    const res = await postJson<ReserveBody>(
      app,
      "/api/reserve",
      { productId: product.id, quantity: 2 },
      user.token,
    );

    expect(res.statusCode).toBe(201);
    expect(res.body.quantity).toBe(2);
    expect(res.body.status).toBe("ACTIVE");
    expect(await getStock(app, product.id)).toBe(3);

    const logs = await app.prisma.inventoryLog.findMany({
      where: { productId: product.id },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.eventType).toBe("RESERVE");
    expect(logs[0]?.delta).toBe(-2);
    expect(logs[0]?.stockAfter).toBe(3);
  });

  it("rejects when stock is insufficient (no partial fulfilment)", async () => {
    const product = await createProduct(app, { stockTotal: 3 });
    const user = await createUser(app);

    const res = await postJson<ApiErrorBody>(
      app,
      "/api/reserve",
      { productId: product.id, quantity: 10 },
      user.token,
    );

    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe("OUT_OF_STOCK");
    // Stock unchanged — the txn was rolled back.
    expect(await getStock(app, product.id)).toBe(3);
    expect(
      await app.prisma.inventoryLog.count({ where: { productId: product.id } }),
    ).toBe(0);
  });

  it("blocks a second ACTIVE reservation for the same user+product", async () => {
    const product = await createProduct(app, { stockTotal: 5 });
    const user = await createUser(app);

    const first = await postJson<ReserveBody>(
      app,
      "/api/reserve",
      { productId: product.id, quantity: 1 },
      user.token,
    );
    expect(first.statusCode).toBe(201);

    const dup = await postJson<ApiErrorBody>(
      app,
      "/api/reserve",
      { productId: product.id, quantity: 1 },
      user.token,
    );
    expect(dup.statusCode).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE_RESERVATION");
    expect(await getStock(app, product.id)).toBe(4);
  });

  it("allows a second reservation after the first is checked out", async () => {
    const product = await createProduct(app, { stockTotal: 5 });
    const user = await createUser(app);
    const r1 = await postJson<ReserveBody>(
      app,
      "/api/reserve",
      { productId: product.id, quantity: 1 },
      user.token,
    );
    await postJson<OrderBody>(
      app,
      "/api/checkout",
      { reservationId: r1.body.reservationId },
      user.token,
    );
    const r2 = await postJson<ReserveBody>(
      app,
      "/api/reserve",
      { productId: product.id, quantity: 1 },
      user.token,
    );
    expect(r2.statusCode).toBe(201);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const product = await createProduct(app);
    const res = await postJson<ApiErrorBody>(app, "/api/reserve", {
      productId: product.id,
      quantity: 1,
    });
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects malformed input with 400 VALIDATION_ERROR", async () => {
    const user = await createUser(app);
    const res = await postJson<ApiErrorBody>(
      app,
      "/api/reserve",
      { productId: "not-a-uuid", quantity: 0 },
      user.token,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/checkout", () => {
  it("converts an ACTIVE reservation into an Order", async () => {
    const product = await createProduct(app, { stockTotal: 5, priceCents: 2500 });
    const user = await createUser(app);
    const reserved = await postJson<ReserveBody>(
      app,
      "/api/reserve",
      { productId: product.id, quantity: 2 },
      user.token,
    );

    const res = await postJson<OrderBody>(
      app,
      "/api/checkout",
      { reservationId: reserved.body.reservationId },
      user.token,
    );
    expect(res.statusCode).toBe(201);
    expect(res.body.totalCents).toBe(5000);

    // Stock did NOT change at checkout (it was already deducted at reserve).
    expect(await getStock(app, product.id)).toBe(3);

    const r = await app.prisma.reservation.findUnique({
      where: { id: reserved.body.reservationId },
    });
    expect(r?.status).toBe("COMPLETED");
    expect(r?.completedAt).not.toBeNull();
  });

  it("rejects a double-checkout with ALREADY_USED", async () => {
    const product = await createProduct(app, { stockTotal: 5 });
    const user = await createUser(app);
    const r = await postJson<ReserveBody>(
      app,
      "/api/reserve",
      { productId: product.id, quantity: 1 },
      user.token,
    );
    await postJson(app, "/api/checkout", { reservationId: r.body.reservationId }, user.token);
    const second = await postJson<ApiErrorBody>(
      app,
      "/api/checkout",
      { reservationId: r.body.reservationId },
      user.token,
    );
    expect(second.statusCode).toBe(409);
    expect(second.body.error.code).toBe("RESERVATION_ALREADY_USED");
  });

  it("rejects checkout of a reservation belonging to another user", async () => {
    const product = await createProduct(app, { stockTotal: 5 });
    const owner = await createUser(app);
    const intruder = await createUser(app);
    const r = await postJson<ReserveBody>(
      app,
      "/api/reserve",
      { productId: product.id, quantity: 1 },
      owner.token,
    );

    const res = await postJson<ApiErrorBody>(
      app,
      "/api/checkout",
      { reservationId: r.body.reservationId },
      intruder.token,
    );
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects checkout of an expired reservation with 410", async () => {
    const product = await createProduct(app, { stockTotal: 5 });
    const user = await createUser(app);
    const r = await postJson<ReserveBody>(
      app,
      "/api/reserve",
      { productId: product.id, quantity: 1 },
      user.token,
    );

    // Force the reservation past its expiry without involving the sweeper.
    await app.prisma.reservation.update({
      where: { id: r.body.reservationId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await postJson<ApiErrorBody>(
      app,
      "/api/checkout",
      { reservationId: r.body.reservationId },
      user.token,
    );
    expect(res.statusCode).toBe(410);
    expect(res.body.error.code).toBe("RESERVATION_EXPIRED");
  });
});

describe("expiry sweeper", () => {
  it("expires ACTIVE reservations whose expiresAt has passed and restores stock", async () => {
    const product = await createProduct(app, { stockTotal: 5 });
    const user = await createUser(app);
    const r = await postJson<ReserveBody>(
      app,
      "/api/reserve",
      { productId: product.id, quantity: 2 },
      user.token,
    );
    expect(await getStock(app, product.id)).toBe(3);

    // Backdate the reservation's expiry rather than waiting on RESERVATION_TTL.
    await app.prisma.reservation.update({
      where: { id: r.body.reservationId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await sweepExpiredReservations(app);
    expect(result.expired).toBe(1);

    // Stock fully restored.
    expect(await getStock(app, product.id)).toBe(5);

    const reservation = await app.prisma.reservation.findUnique({
      where: { id: r.body.reservationId },
    });
    expect(reservation?.status).toBe("EXPIRED");

    const logs = await app.prisma.inventoryLog.findMany({
      where: { productId: product.id },
      orderBy: { createdAt: "asc" },
    });
    expect(logs.map((l) => l.eventType)).toEqual(["RESERVE", "RELEASE_EXPIRY"]);
    expect(logs[1]?.delta).toBe(2);
    expect(logs[1]?.stockAfter).toBe(5);
  });

  it("does not touch reservations that are still in their TTL", async () => {
    const product = await createProduct(app, { stockTotal: 5 });
    const user = await createUser(app);
    await postJson(
      app,
      "/api/reserve",
      { productId: product.id, quantity: 2 },
      user.token,
    );
    const result = await sweepExpiredReservations(app);
    expect(result.expired).toBe(0);
    expect(await getStock(app, product.id)).toBe(3);
  });

  it("is idempotent — second sweep is a no-op", async () => {
    const product = await createProduct(app, { stockTotal: 5 });
    const user = await createUser(app);
    const r = await postJson<ReserveBody>(
      app,
      "/api/reserve",
      { productId: product.id, quantity: 1 },
      user.token,
    );
    await app.prisma.reservation.update({
      where: { id: r.body.reservationId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await sweepExpiredReservations(app);
    const second = await sweepExpiredReservations(app);
    expect(second.expired).toBe(0);
    expect(await getStock(app, product.id)).toBe(5);
  });
});

describe("GET /api/reservations", () => {
  it("returns only the caller's reservations", async () => {
    const product = await createProduct(app, { stockTotal: 10 });
    const a = await createUser(app);
    const b = await createUser(app);
    await postJson(app, "/api/reserve", { productId: product.id, quantity: 1 }, a.token);
    await postJson(app, "/api/reserve", { productId: product.id, quantity: 1 }, b.token);

    const list = await getJson<ReservationListBody>(
      app,
      "/api/reservations",
      a.token,
    );
    expect(list.statusCode).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items).toHaveLength(1);
  });
});
