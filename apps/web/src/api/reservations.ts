import type {
  CheckoutRequest,
  CheckoutResponse,
  ReserveRequest,
  ReserveResponse,
} from "@lsps/types";
import { api } from "./client";

interface ReservationDTO {
  id: string;
  userId: string;
  productId: string;
  quantity: number;
  status: "ACTIVE" | "COMPLETED" | "EXPIRED" | "CANCELLED";
  expiresAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PagedReservations {
  items: ReservationDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export const reservationsApi = {
  reserve: (body: ReserveRequest) =>
    api<ReserveResponse>("/api/reserve", { method: "POST", body }),

  checkout: (body: CheckoutRequest) =>
    api<CheckoutResponse>("/api/checkout", { method: "POST", body }),

  list: (params: {
    status?: "ACTIVE" | "COMPLETED" | "EXPIRED" | "CANCELLED";
    productId?: string;
    page?: number;
    pageSize?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.productId) qs.set("productId", params.productId);
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return api<PagedReservations>(`/api/reservations${suffix}`);
  },

  get: (id: string) => api<ReservationDTO>(`/api/reservations/${id}`),
};

export type { ReservationDTO };
