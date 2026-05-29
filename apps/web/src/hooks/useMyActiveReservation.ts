import { useQuery } from "@tanstack/react-query";
import { reservationsApi, type ReservationDTO } from "../api/reservations";

/**
 * Returns the caller's currently-ACTIVE reservation for a given product,
 * if any. Used to:
 *   - recover state after a hard refresh (server is the source of truth),
 *   - render the countdown when the user comes back to the page,
 *   - decide whether to show "Reserve" or "Checkout" on the button.
 */
export function useMyActiveReservation(
  productId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["my-reservation", productId],
    queryFn: () =>
      reservationsApi.list({
        status: "ACTIVE",
        productId: productId!,
        pageSize: 1,
      }),
    enabled: enabled && !!productId,
    select: (data): ReservationDTO | null => data.items[0] ?? null,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
