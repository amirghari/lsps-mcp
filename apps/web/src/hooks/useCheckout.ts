import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CheckoutRequest } from "@lsps/types";
import { reservationsApi } from "../api/reservations";

export function useCheckout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CheckoutRequest) => reservationsApi.checkout(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["my-reservation"] });
      // Product stock doesn't change at checkout (already debited at reserve),
      // but invalidate anyway to render the "you bought this" state if needed.
      void qc.invalidateQueries({ queryKey: ["product"] });
    },
    onError: () => {
      void qc.invalidateQueries({ queryKey: ["my-reservation"] });
    },
  });
}
