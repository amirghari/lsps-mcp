import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/lib/passwords.js";

/**
 * Build an app instance for testing.
 *
 * Each test file builds its own app (one buildApp per file), and we rely on
 * vitest's singleFork pool option so all suites share one Node process —
 * Prisma's connection pool is reused rather than re-created per file.
 */
export async function buildTestApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

/**
 * Truncate the working tables in dependency order so each test starts from a
 * clean slate. TRUNCATE … CASCADE on Product would chain into InventoryLog;
 * we go explicit + RESTART IDENTITY for ordering predictability.
 */
export async function resetDb(app: FastifyInstance): Promise<void> {
  await app.prisma.$executeRawUnsafe(
    `TRUNCATE "InventoryLog", "Order", "Reservation", "Product", "User" RESTART IDENTITY CASCADE;`,
  );
}

// bcryptjs is pure-JS and CPU-bound on the event loop. Hashing 100 fresh
// passwords in parallel inside a test will saturate the loop and trip
// @fastify/under-pressure into shedding 503s. We don't exercise the
// password-verification path in these tests (tokens are minted directly via
// app.jwt.sign), so a single shared hash is safe and ~100× faster.
let cachedHash: string | null = null;
async function getCachedHash(): Promise<string> {
  if (cachedHash === null) cachedHash = await hashPassword("test-password-1");
  return cachedHash;
}

export async function createUser(
  app: FastifyInstance,
  overrides: Partial<{ email: string; password: string; displayName: string }> = {},
): Promise<{ id: string; email: string; token: string }> {
  const email = overrides.email ?? `u-${randomUUID()}@lsps.test`;
  const passwordHash = overrides.password
    ? await hashPassword(overrides.password)
    : await getCachedHash();
  const user = await app.prisma.user.create({
    data: {
      email,
      passwordHash,
      displayName: overrides.displayName ?? null,
    },
  });
  const token = app.jwt.sign({ sub: user.id, email: user.email });
  return { id: user.id, email: user.email, token };
}

export async function createProduct(
  app: FastifyInstance,
  overrides: Partial<{
    sku: string;
    name: string;
    priceCents: number;
    currency: string;
    stockTotal: number;
    stockAvailable: number;
  }> = {},
): Promise<{
  id: string;
  sku: string;
  priceCents: number;
  stockTotal: number;
  stockAvailable: number;
}> {
  const stock = overrides.stockTotal ?? 10;
  const product = await app.prisma.product.create({
    data: {
      sku: overrides.sku ?? `SKU-${randomUUID().slice(0, 8)}`,
      name: overrides.name ?? "Test Drop",
      priceCents: overrides.priceCents ?? 1000,
      currency: overrides.currency ?? "EUR",
      stockTotal: overrides.stockTotal ?? stock,
      stockAvailable: overrides.stockAvailable ?? stock,
    },
  });
  return {
    id: product.id,
    sku: product.sku,
    priceCents: product.priceCents,
    stockTotal: product.stockTotal,
    stockAvailable: product.stockAvailable,
  };
}

export async function getStock(
  app: FastifyInstance,
  productId: string,
): Promise<number> {
  const p = await app.prisma.product.findUnique({
    where: { id: productId },
    select: { stockAvailable: true },
  });
  if (!p) throw new Error("product not found");
  return p.stockAvailable;
}

interface InjectResponseShape<T> {
  statusCode: number;
  body: T;
}

export async function postJson<T = unknown>(
  app: FastifyInstance,
  url: string,
  payload: Record<string, unknown>,
  token?: string,
): Promise<InjectResponseShape<T>> {
  const res = await app.inject({
    method: "POST",
    url,
    payload: payload as object,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return {
    statusCode: res.statusCode,
    body: JSON.parse(res.body) as T,
  };
}

export async function getJson<T = unknown>(
  app: FastifyInstance,
  url: string,
  token?: string,
): Promise<InjectResponseShape<T>> {
  const res = await app.inject({
    method: "GET",
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return {
    statusCode: res.statusCode,
    body: JSON.parse(res.body) as T,
  };
}
