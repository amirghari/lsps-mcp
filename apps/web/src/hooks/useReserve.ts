import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReserveRequest } from "@lsps/types";
import { reservationsApi } from "../api/reservations";

/**
 * On success, immediately invalidate both the product query (so the stock
 * badge updates without waiting for the next 5s poll tick) and the user's
 * active-reservation query (so the countdown badge appears).
 */
export function useReserve() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReserveRequest) => reservationsApi.reserve(body),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ["product", variables.productId] });
      void qc.invalidateQueries({ queryKey: ["my-reservation"] });
    },
    onError: (_err, variables) => {
      // Race lost or duplicate / expired — re-sync so the UI catches up.
      void qc.invalidateQueries({ queryKey: ["product", variables.productId] });
      void qc.invalidateQueries({ queryKey: ["my-reservation"] });
    },
  });
}
