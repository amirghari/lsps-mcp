import type { FastifyInstance } from "fastify";
import { Prisma, ReservationStatus } from "@prisma/client";
import type { ReserveResponse, CheckoutResponse } from "@lsps/types";
import { errors } from "../lib/errors.js";

interface ReserveInput {
  userId: string;
  productId: string;
  quantity: number;
}

interface CheckoutInput {
  userId: string;
  reservationId: string;
}

// Postgres unique violation code (we don't currently have a partial unique on
// reservations but keeping the constant here in case we add one later).
const PG_UNIQUE_VIOLATION = "P2002";

/**
 * POST /reserve — reserve N units of a product for `userId`.
 *
 * Concurrency contract:
 *   1. Open a `$transaction` at READ COMMITTED (Postgres default).
 *   2. Acquire a row-level lock on the Product row with
 *      `SELECT id, sku, "stockAvailable" FROM "Product" WHERE id = $1 FOR UPDATE`.
 *      Concurrent reservers of the SAME SKU queue at this point; reservers of
 *      different SKUs never block each other.
 *   3. Re-read stock under the lock — the value seen outside the lock is stale
 *      by definition and must not be trusted.
 *   4. Reject if insufficient stock (409 OUT_OF_STOCK).
 *   5. Enforce "one ACTIVE reservation per (userId, productId)" inside the
 *      same txn so duplicate-reservation spam from one user cannot drain stock
 *      that won't be paid for (409 DUPLICATE_RESERVATION).
 *   6. Decrement `stockAvailable`, insert the Reservation, append a signed
 *      `InventoryLog` row (delta = -quantity, stockAfter = new stock). All
 *      three writes commit atomically.
 *
 * Because writes happen under the Product row lock, `stockAvailable` is the
 * single source of truth for "how many can still be reserved" and is
 * structurally prevented from going negative.
 */
export async function reserve(
  app: FastifyInstance,
  input: ReserveInput,
): Promise<ReserveResponse> {
  const { userId, productId, quantity } = input;
  const ttlSec = app.config.RESERVATION_TTL_SECONDS;

  try {
    const reservation = await app.prisma.$transaction(
      async (tx) => {
        // see options on the outer $transaction call
        // 1. Lock the product row. Raw SQL because Prisma's typed API doesn't
        //    issue SELECT ... FOR UPDATE.
        const locked = await tx.$queryRaw<
          Array<{ id: string; sku: string; stockAvailable: number }>
        >`SELECT id, sku, "stockAvailable"
            FROM "Product"
           WHERE id = ${productId}::uuid
           FOR UPDATE`;

        if (locked.length === 0) {
          throw errors.notFound("Product not found");
        }
        const product = locked[0]!;

        // 2. Stock check under the lock.
        if (product.stockAvailable < quantity) {
          app.metrics.outOfStockRejections.inc({ product_sku: product.sku });
          throw errors.outOfStock(
            `Only ${product.stockAvailable} unit(s) available for ${product.sku}`,
            { available: product.stockAvailable, requested: quantity },
          );
        }

        // 3. Duplicate-reservation guard. A row lock on Product means no other
        //    txn can be writing reservations for this user+product right now,
        //    so this read is sufficient (no extra lock needed).
        const dup = await tx.reservation.findFirst({
          where: { userId, productId, status: ReservationStatus.ACTIVE },
          select: { id: true },
        });
        if (dup) {
          throw errors.duplicate(
            `User already has an active reservation for ${product.sku}`,
          );
        }

        // 4. Decrement stock.
        const newStock = product.stockAvailable - quantity;
        await tx.product.update({
          where: { id: productId },
          data: { stockAvailable: newStock },
        });

        // 5. Insert reservation.
        const expiresAt = new Date(Date.now() + ttlSec * 1000);
        const created = await tx.reservation.create({
          data: {
            userId,
            productId,
            quantity,
            status: ReservationStatus.ACTIVE,
            expiresAt,
          },
        });

        // 6. Append audit log. delta is negative because stock left the pool.
        await tx.inventoryLog.create({
          data: {
            productId,
            userId,
            reservationId: created.id,
            eventType: "RESERVE",
            delta: -quantity,
            stockAfter: newStock,
          },
        });

        app.metrics.reservationsCreated.inc({ product_sku: product.sku });

        return created;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        // Under heavy concurrent contention on a single SKU, reservers
        // serialize at the FOR UPDATE lock. Give a generous wallclock budget
        // (still bounded — beyond this we'd rather 503 than hold rows forever).
        timeout: 30_000,
        maxWait: 30_000,
      },
    );

    return {
      reservationId: reservation.id,
      productId: reservation.productId,
      quantity: reservation.quantity,
      expiresAt: reservation.expiresAt.toISOString(),
      status: reservation.status,
    };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === PG_UNIQUE_VIOLATION
    ) {
      throw errors.duplicate();
    }
    throw err;
  }
}

/**
 * POST /checkout — convert an ACTIVE reservation owned by `userId` to an Order.
 *
 * Concurrency contract:
 *   1. `$transaction` at READ COMMITTED.
 *   2. Lock the Reservation row with `SELECT … FOR UPDATE`. This serializes
 *      any concurrent checkout/cancel for the same reservation and blocks the
 *      expiry sweeper from racing us (the sweeper uses SKIP LOCKED, so it'll
 *      simply move past this row while we're inside).
 *   3. Validate ownership + status + expiry under the lock. Any failure
 *      throws a precise 401/403/409/410 — never a generic 500.
 *   4. Create the Order, mark the reservation COMPLETED, append a CHECKOUT
 *      InventoryLog (delta = 0; stock was already deducted at reserve time,
 *      but we record the stockAfter snapshot for ledger continuity).
 *
 * Note we do NOT touch Product.stockAvailable here — checkout converts a
 * reservation into a sale; the inventory was already committed at reserve.
 */
export async function checkout(
  app: FastifyInstance,
  input: CheckoutInput,
): Promise<CheckoutResponse> {
  const { userId, reservationId } = input;
  const now = new Date();

  const order = await app.prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{
          id: string;
          userId: string;
          productId: string;
          quantity: number;
          status: ReservationStatus;
          expiresAt: Date;
        }>
      >`SELECT id, "userId", "productId", quantity, status, "expiresAt"
          FROM "Reservation"
         WHERE id = ${reservationId}::uuid
         FOR UPDATE`;

      if (locked.length === 0) {
        throw errors.notFound("Reservation not found");
      }
      const r = locked[0]!;

      if (r.userId !== userId) {
        throw errors.forbidden("Reservation belongs to a different user");
      }
      if (r.status === ReservationStatus.EXPIRED || r.expiresAt < now) {
        throw errors.expired();
      }
      if (r.status !== ReservationStatus.ACTIVE) {
        throw errors.alreadyUsed(
          `Reservation is ${r.status.toLowerCase()}, not ACTIVE`,
        );
      }

      // We need priceCents + currency + an up-to-date stockAfter for the log.
      // The Product row lock from the reserve path is irrelevant here (we are
      // not touching stockAvailable), so a plain read is fine.
      const product = await tx.product.findUnique({
        where: { id: r.productId },
        select: { priceCents: true, currency: true, stockAvailable: true, sku: true },
      });
      if (!product) {
        // Schema enforces FK, this should be impossible.
        throw errors.notFound("Product disappeared mid-checkout");
      }

      const totalCents = product.priceCents * r.quantity;

      const createdOrder = await tx.order.create({
        data: {
          reservationId: r.id,
          userId: r.userId,
          productId: r.productId,
          quantity: r.quantity,
          totalCents,
          currency: product.currency,
        },
      });

      await tx.reservation.update({
        where: { id: r.id },
        data: {
          status: ReservationStatus.COMPLETED,
          completedAt: now,
        },
      });

      await tx.inventoryLog.create({
        data: {
          productId: r.productId,
          userId: r.userId,
          reservationId: r.id,
          orderId: createdOrder.id,
          eventType: "CHECKOUT",
          delta: 0,
          stockAfter: product.stockAvailable,
        },
      });

      app.metrics.reservationsCheckedOut.inc({ product_sku: product.sku });

      return createdOrder;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 30_000,
      maxWait: 30_000,
    },
  );

  return {
    orderId: order.id,
    reservationId: order.reservationId,
    productId: order.productId,
    quantity: order.quantity,
    totalCents: order.totalCents,
    currency: order.currency,
    createdAt: order.createdAt.toISOString(),
  };
}
