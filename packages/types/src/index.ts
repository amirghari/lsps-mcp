import { z } from "zod";

export const ReservationStatus = z.enum([
  "ACTIVE",
  "COMPLETED",
  "EXPIRED",
  "CANCELLED",
]);
export type ReservationStatus = z.infer<typeof ReservationStatus>;

export const InventoryEventType = z.enum([
  "RESERVE",
  "RELEASE_EXPIRY",
  "RELEASE_CANCEL",
  "CHECKOUT",
  "ADJUSTMENT",
]);
export type InventoryEventType = z.infer<typeof InventoryEventType>;

export const ProductDTO = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  priceCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  stockTotal: z.number().int().nonnegative(),
  stockAvailable: z.number().int().nonnegative(),
  dropAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProductDTO = z.infer<typeof ProductDTO>;

export const ReserveRequest = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive().max(10),
});
export type ReserveRequest = z.infer<typeof ReserveRequest>;

export const ReserveResponse = z.object({
  reservationId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  expiresAt: z.string().datetime(),
  status: ReservationStatus,
});
export type ReserveResponse = z.infer<typeof ReserveResponse>;

export const CheckoutRequest = z.object({
  reservationId: z.string().uuid(),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequest>;

export const CheckoutResponse = z.object({
  orderId: z.string().uuid(),
  reservationId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  totalCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  createdAt: z.string().datetime(),
});
export type CheckoutResponse = z.infer<typeof CheckoutResponse>;

export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
  requestId: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiError>;

export const Pagination = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export type Pagination = z.infer<typeof Pagination>;

export const Paged = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  });

export const AuthRegisterRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(80).optional(),
});
export type AuthRegisterRequest = z.infer<typeof AuthRegisterRequest>;

export const AuthLoginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});
export type AuthLoginRequest = z.infer<typeof AuthLoginRequest>;

export const AuthResponse = z.object({
  token: z.string(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    displayName: z.string().nullable(),
  }),
});
export type AuthResponse = z.infer<typeof AuthResponse>;
