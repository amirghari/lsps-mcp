export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "OUT_OF_STOCK"
  | "RESERVATION_EXPIRED"
  | "RESERVATION_ALREADY_USED"
  | "DUPLICATE_RESERVATION"
  | "RATE_LIMITED"
  | "INTERNAL";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number,
    details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const errors = {
  notFound: (msg: string) => new AppError("NOT_FOUND", msg, 404),
  unauthorized: (msg = "Unauthorized") =>
    new AppError("UNAUTHORIZED", msg, 401),
  forbidden: (msg = "Forbidden") => new AppError("FORBIDDEN", msg, 403),
  conflict: (msg: string, code: ErrorCode = "CONFLICT", details?: unknown) =>
    new AppError(code, msg, 409, details),
  outOfStock: (msg = "Insufficient stock", details?: unknown) =>
    new AppError("OUT_OF_STOCK", msg, 409, details),
  expired: (msg = "Reservation has expired") =>
    new AppError("RESERVATION_EXPIRED", msg, 410),
  alreadyUsed: (msg = "Reservation already completed or cancelled") =>
    new AppError("RESERVATION_ALREADY_USED", msg, 409),
  duplicate: (msg = "An active reservation already exists for this product") =>
    new AppError("DUPLICATE_RESERVATION", msg, 409),
  validation: (msg: string, details?: unknown) =>
    new AppError("VALIDATION_ERROR", msg, 400, details),
};
