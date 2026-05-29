import { useEffect, useMemo, useState } from "react";
import type { ProductDTO } from "@lsps/types";
import { useCheckout } from "../hooks/useCheckout";
import { useCountdown } from "../hooks/useCountdown";
import { useMyActiveReservation } from "../hooks/useMyActiveReservation";
import { useReserve } from "../hooks/useReserve";
import { toUserFacing, type UserFacingError } from "../lib/errors";
import { Button } from "./ui/Button";
import { CountdownBadge } from "./CountdownBadge";
import { ErrorBanner, StatusMessage } from "./StatusMessage";

interface DropCardProps {
  product: ProductDTO;
  isAuthenticated: boolean;
  onSignInPrompt?: () => void;
}

function formatPrice(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/**
 * The "Limited Drop Page" centerpiece.
 *
 * State machine, driven by:
 *   - product.stockAvailable          (live, polled every 5s)
 *   - reservation?.status, .expiresAt (current ACTIVE reservation, if any)
 *   - reserve/checkout mutation states
 *
 *   IDLE          → no reservation, stock > 0  ........... show [Reserve]
 *   SOLD_OUT      → no reservation, stock === 0 .......... show "Sold out" (button disabled)
 *   ACTIVE        → reservation ACTIVE, not expired ...... show countdown + [Checkout]
 *   EXPIRED       → reservation expired locally .......... show "Expired", offer reserve again
 *   CHECKED_OUT   → checkout succeeded ................... show success state
 *   ERROR(*)      → any mutation error  .................. show ErrorBanner (retryable=Y/N)
 */
export function DropCard({
  product,
  isAuthenticated,
  onSignInPrompt,
}: DropCardProps) {
  const reservationQuery = useMyActiveReservation(product.id, isAuthenticated);
  const reservation = reservationQuery.data ?? null;

  const reserveMutation = useReserve();
  const checkoutMutation = useCheckout();

  const countdown = useCountdown(reservation?.expiresAt ?? null);

  const [checkedOutOrderId, setCheckedOutOrderId] = useState<string | null>(
    null,
  );
  const [reserveErr, setReserveErr] = useState<UserFacingError | null>(null);
  const [checkoutErr, setCheckoutErr] = useState<UserFacingError | null>(null);

  // Clear the stale "checked out" banner when the reservation list changes
  // (e.g., user signs out + back in).
  useEffect(() => {
    if (!reservation && checkedOutOrderId) {
      // keep success banner up; nothing to do
    }
  }, [reservation, checkedOutOrderId]);

  const handleReserve = async () => {
    if (!isAuthenticated) {
      onSignInPrompt?.();
      return;
    }
    setReserveErr(null);
    setCheckedOutOrderId(null);
    try {
      await reserveMutation.mutateAsync({ productId: product.id, quantity: 1 });
    } catch (err) {
      setReserveErr(toUserFacing(err));
    }
  };

  const handleCheckout = async () => {
    if (!reservation) return;
    setCheckoutErr(null);
    try {
      const result = await checkoutMutation.mutateAsync({
        reservationId: reservation.id,
      });
      setCheckedOutOrderId(result.orderId);
    } catch (err) {
      setCheckoutErr(toUserFacing(err));
    }
  };

  // Derived state for the primary button.
  const button = useMemo(() => {
    if (checkedOutOrderId) {
      return null;
    }
    if (reservation && !countdown.isExpired) {
      return (
        <Button
          variant="success"
          size="lg"
          className="w-full"
          loading={checkoutMutation.isPending}
          onClick={handleCheckout}
        >
          Complete checkout
        </Button>
      );
    }
    if (reservation && countdown.isExpired) {
      // Server may still say ACTIVE for a few seconds until the sweeper runs;
      // the API will return 410 if we try to checkout. Surface "reserve again".
      return (
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          loading={reserveMutation.isPending}
          onClick={handleReserve}
          disabled={product.stockAvailable === 0}
        >
          {product.stockAvailable === 0
            ? "Sold out"
            : "Your reservation expired — reserve again"}
        </Button>
      );
    }
    if (product.stockAvailable === 0) {
      return (
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled
        >
          Sold out
        </Button>
      );
    }
    return (
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        loading={reserveMutation.isPending}
        onClick={handleReserve}
      >
        Reserve 1 unit
      </Button>
    );
  }, [
    checkedOutOrderId,
    reservation,
    countdown.isExpired,
    checkoutMutation.isPending,
    reserveMutation.isPending,
    product.stockAvailable,
  ]);

  const stockBadge = (
    <div
      aria-live="polite"
      className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 font-mono text-xs tabular-nums text-slate-300"
    >
      {product.stockAvailable} / {product.stockTotal} left
    </div>
  );

  return (
    <article className="w-full max-w-xl space-y-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-2xl shadow-indigo-500/5 backdrop-blur">
      <header className="space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs uppercase tracking-widest text-slate-500">
            {product.sku}
          </span>
          {stockBadge}
        </div>
        <h2 className="text-3xl font-semibold text-slate-100">{product.name}</h2>
        {product.description ? (
          <p className="text-sm leading-relaxed text-slate-400">
            {product.description}
          </p>
        ) : null}
        <div className="text-2xl font-semibold text-indigo-300">
          {formatPrice(product.priceCents, product.currency)}
        </div>
      </header>

      {reservation && !countdown.isExpired ? (
        <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
          <div className="space-y-0.5">
            <p className="text-xs uppercase tracking-wider text-slate-500">
              Your reservation
            </p>
            <p className="font-mono text-xs text-slate-400">
              {reservation.id.slice(0, 8)}…
            </p>
          </div>
          <CountdownBadge
            mmss={countdown.mmss}
            secondsLeft={countdown.secondsLeft}
            isExpired={countdown.isExpired}
          />
        </div>
      ) : null}

      {button}

      {checkedOutOrderId ? (
        <StatusMessage
          tone="success"
          title="Order placed"
          message={`Order ID ${checkedOutOrderId.slice(0, 8)}… — your unit is yours.`}
        />
      ) : null}

      {reserveErr ? (
        <ErrorBanner
          error={reserveErr}
          onDismiss={() => setReserveErr(null)}
          onRetry={
            reserveErr.retryable ? () => void handleReserve() : undefined
          }
        />
      ) : null}

      {checkoutErr ? (
        <ErrorBanner
          error={checkoutErr}
          onDismiss={() => setCheckoutErr(null)}
          onRetry={
            checkoutErr.retryable ? () => void handleCheckout() : undefined
          }
        />
      ) : null}

      {!isAuthenticated ? (
        <p className="text-center text-xs text-slate-500">
          Sign in to reserve. Reservations expire after 5 minutes.
        </p>
      ) : null}
    </article>
  );
}
