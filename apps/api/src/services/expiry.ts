import type { FastifyInstance } from "fastify";

/**
 * Background sweeper: expire ACTIVE reservations whose expiresAt has passed,
 * restore their reserved units to stockAvailable, and log RELEASE_EXPIRY.
 *
 * TODO(day-2): implement this. Use a single transaction per batch with
 * SELECT ... FOR UPDATE SKIP LOCKED so the sweeper never blocks live reservers.
 */
export async function sweepExpiredReservations(
  _app: FastifyInstance,
): Promise<{ expired: number }> {
  return { expired: 0 };
}
