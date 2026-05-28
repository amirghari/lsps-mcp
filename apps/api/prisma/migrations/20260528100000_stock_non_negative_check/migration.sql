-- Defensive CHECK constraints. The application enforces these invariants
-- inside the reservation transaction (see services/reservations.ts), but a
-- DB-level CHECK means even a buggy migration or a misbehaving direct SQL
-- caller cannot put the inventory into an illegal state.
--
-- Postgres will reject any UPDATE/INSERT that would violate these, so the
-- "stock must never go negative" requirement is enforced at the layer that
-- cannot be bypassed.

ALTER TABLE "Product"
  ADD CONSTRAINT "product_stock_available_non_negative"
  CHECK ("stockAvailable" >= 0);

ALTER TABLE "Product"
  ADD CONSTRAINT "product_stock_total_non_negative"
  CHECK ("stockTotal" >= 0);

ALTER TABLE "Product"
  ADD CONSTRAINT "product_stock_available_le_total"
  CHECK ("stockAvailable" <= "stockTotal");

ALTER TABLE "Reservation"
  ADD CONSTRAINT "reservation_quantity_positive"
  CHECK (quantity > 0);

ALTER TABLE "Order"
  ADD CONSTRAINT "order_quantity_positive"
  CHECK (quantity > 0);

ALTER TABLE "Order"
  ADD CONSTRAINT "order_total_cents_non_negative"
  CHECK ("totalCents" >= 0);
