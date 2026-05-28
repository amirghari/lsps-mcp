import type { FastifyInstance } from "fastify";
import { Prisma, ReservationStatus } from "@prisma/client";

const DEFAULT_BATCH_SIZE = 100;

interface ExpiredRow {
  id: string;
  productId: string;
  userId: string;
  quantity: number;
}

/**
 * Sweep up to `batchSize` expired ACTIVE reservations and restore their stock.
 *
 * Concurrency contract:
 *   - One transaction per call (one batch).
 *   - `SELECT ... FOR UPDATE SKIP LOCKED` on Reservation so the sweeper never
 *     blocks (and is never blocked by) checkout/reserve flows that are
 *     currently holding row locks on specific reservations.
 *   - Products are locked individually after grouping the expired rows by
 *     product, and product IDs are processed in sorted order to give a
 *     consistent lock acquisition order if a second sweeper instance ever
 *     runs concurrently.
 *   - Per reservation we write one RELEASE_EXPIRY InventoryLog row with a
 *     running `stockAfter`, which preserves the ledger's monotonic-after
 *     invariant inside the batch.
 */
export async function sweepExpiredReservations(
  app: FastifyInstance,
  batchSize: number = DEFAULT_BATCH_SIZE,
): Promise<{ expired: number }> {
  const now = new Date();

  const expiredCount = await app.prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<ExpiredRow[]>`
        SELECT id, "productId", "userId", quantity
          FROM "Reservation"
         WHERE status = ${ReservationStatus.ACTIVE}::"ReservationStatus"
           AND "expiresAt" < ${now}
         ORDER BY "expiresAt" ASC, "productId" ASC
         LIMIT ${batchSize}
         FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) return 0;

      const byProduct = new Map<string, ExpiredRow[]>();
      for (const r of rows) {
        const bucket = byProduct.get(r.productId) ?? [];
        bucket.push(r);
        byProduct.set(r.productId, bucket);
      }

      // Deterministic lock order across products: sorted by uuid string.
      const productIds = [...byProduct.keys()].sort();

      for (const productId of productIds) {
        const items = byProduct.get(productId);
        if (!items || items.length === 0) continue;

        const totalQty = items.reduce((sum, r) => sum + r.quantity, 0);

        const locked = await tx.$queryRaw<
          Array<{ stockAvailable: number }>
        >`SELECT "stockAvailable"
            FROM "Product"
           WHERE id = ${productId}::uuid
           FOR UPDATE`;

        if (locked.length === 0) continue; // product gone — shouldn't happen with FK Restrict
        const before = locked[0]!.stockAvailable;
        const after = before + totalQty;

        await tx.product.update({
          where: { id: productId },
          data: { stockAvailable: after },
        });

        // Log each expired reservation with a running stockAfter so the
        // ledger ordering matches the actual stock progression.
        let running = before;
        for (const r of items) {
          running += r.quantity;
          await tx.inventoryLog.create({
            data: {
              productId,
              userId: r.userId,
              reservationId: r.id,
              eventType: "RELEASE_EXPIRY",
              delta: r.quantity,
              stockAfter: running,
            },
          });
        }
      }

      await tx.reservation.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { status: ReservationStatus.EXPIRED },
      });

      return rows.length;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );

  if (expiredCount > 0) {
    app.metrics.reservationsExpired.inc(expiredCount);
    app.log.info(
      { count: expiredCount },
      "Sweeper released expired reservations",
    );
  }

  return { expired: expiredCount };
}

/**
 * Start a periodic sweeper using a plain `setInterval`. Tests call
 * `sweepExpiredReservations` directly and never start this loop — keeps tests
 * deterministic.
 */
export function startExpiryCron(app: FastifyInstance): () => void {
  const intervalMs = app.config.EXPIRY_SWEEP_INTERVAL_SECONDS * 1000;
  let running = false;

  const tick = async () => {
    if (running) return; // skip if previous tick still in flight
    running = true;
    try {
      await sweepExpiredReservations(app);
    } catch (err) {
      app.log.error({ err }, "Expiry sweeper failed");
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, intervalMs);

  app.log.info(
    { intervalMs },
    "Expiry sweeper started (in-process setInterval)",
  );

  // Run one immediate tick on startup so we don't wait the full interval.
  void tick();

  return () => clearInterval(handle);
}
