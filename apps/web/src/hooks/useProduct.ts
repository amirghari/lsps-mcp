import { useQuery } from "@tanstack/react-query";
import { productsApi } from "../api/products";

const FIVE_SECONDS = 5_000;

/**
 * Single-product fetch with 5s polling — the spec's "real-time refresh
 * every 5s" requirement. TanStack Query handles the interval, retry policy,
 * and stale-while-revalidate. We keep polling even when the tab is
 * backgrounded (refetchIntervalInBackground) so the stock badge is fresh
 * the moment the user returns.
 */
export function useProduct(productId: string | null) {
  return useQuery({
    queryKey: ["product", productId],
    queryFn: ({ signal }) => productsApi.get(productId!, signal),
    enabled: !!productId,
    refetchInterval: FIVE_SECONDS,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
}

export function useFirstProduct() {
  return useQuery({
    queryKey: ["product", "first"],
    queryFn: () => productsApi.list({ pageSize: 1 }),
    select: (data) => data.items[0] ?? null,
    staleTime: 60_000,
  });
}
