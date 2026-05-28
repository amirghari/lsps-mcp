import type { FastifyInstance } from "fastify";
import type {
  ReserveResponse,
  CheckoutResponse,
} from "@lsps/types";
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

/**
 * Reserve N units of a product for the user.
 *
 * Concurrency strategy (the heart of LSPS):
 *   1. Open a transaction at READ COMMITTED (Postgres default).
 *   2. Acquire a row-level lock on the Product row with SELECT ... FOR UPDATE,
 *      which serializes reservers of the same SKU.
 *   3. Re-check stock under the lock — never trust the value read outside it.
 *   4. Decrement stockAvailable, insert the Reservation, write the InventoryLog.
 *   5. Commit. Concurrent reservers wait at step 2 and resume after commit
 *      with the post-decrement stock value, so overselling is structurally impossible.
 *
 * Duplicate-reservation guard: enforced inside the same txn ("one ACTIVE per
 * (userId, productId)") before any stock movement.
 *
 * TODO(day-2): implement this. Stub returns 501 for now so the skeleton boots.
 */
export async function reserve(
  _app: FastifyInstance,
  _input: ReserveInput,
): Promise<ReserveResponse> {
  throw errors.conflict(
    "Reserve flow not yet implemented (Day 2 milestone).",
    "INTERNAL",
  );
}

/**
 * Convert an ACTIVE reservation belonging to the caller into an Order.
 *
 * TODO(day-2): implement this. Validate ownership, status, and expiry under a
 * Reservation-row lock; create the Order; mark reservation COMPLETED; log CHECKOUT.
 */
export async function checkout(
  _app: FastifyInstance,
  _input: CheckoutInput,
): Promise<CheckoutResponse> {
  throw errors.conflict(
    "Checkout flow not yet implemented (Day 2 milestone).",
    "INTERNAL",
  );
}
