import type { ProductDTO } from "@lsps/types";
import { api } from "./client";

interface PagedProducts {
  items: ProductDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export const productsApi = {
  list: (params: { page?: number; pageSize?: number; available?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    if (params.available !== undefined)
      qs.set("available", String(params.available));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return api<PagedProducts>(`/api/products${suffix}`, { auth: false });
  },

  get: (id: string, signal?: AbortSignal) =>
    api<ProductDTO>(`/api/products/${id}`, { auth: false, signal }),
};
