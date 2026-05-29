import {
  ApiNetworkError,
  ApiRequestError,
  ApiTimeoutError,
} from "../api/client";

export interface UserFacingError {
  title: string;
  message: string;
  /** If true, the user should be able to retry the same action immediately. */
  retryable: boolean;
  /** If true, the underlying state changed and the UI should re-fetch. */
  refetch: boolean;
}

/**
 * Map any error from the API client into a small, predictable shape the UI
 * can render. The four edge cases the spec calls out are all covered:
 *   - Race condition  → OUT_OF_STOCK / DUPLICATE_RESERVATION
 *   - Stock = 0 mid-page → OUT_OF_STOCK on reserve attempt
 *   - Network failure → ApiNetworkError
 *   - API timeout → ApiTimeoutError
 */
export function toUserFacing(err: unknown): UserFacingError {
  if (err instanceof ApiTimeoutError) {
    return {
      title: "Server is slow",
      message: "The reservation API didn't respond in time. Try again.",
      retryable: true,
      refetch: true,
    };
  }
  if (err instanceof ApiNetworkError) {
    return {
      title: "You're offline",
      message:
        "We couldn't reach the server. Check your connection and retry.",
      retryable: true,
      refetch: false,
    };
  }
  if (err instanceof ApiRequestError) {
    switch (err.code) {
      case "OUT_OF_STOCK":
        return {
          title: "Sold out",
          message:
            "Someone reserved the last unit while you were looking. The page will refresh.",
          retryable: false,
          refetch: true,
        };
      case "DUPLICATE_RESERVATION":
        return {
          title: "Already reserved",
          message:
            "You already have an active reservation for this drop. Checkout or wait for it to expire.",
          retryable: false,
          refetch: true,
        };
      case "RESERVATION_EXPIRED":
        return {
          title: "Reservation expired",
          message:
            "Your 5-minute window ended. Try reserving again if stock is still available.",
          retryable: false,
          refetch: true,
        };
      case "RESERVATION_ALREADY_USED":
        return {
          title: "Already used",
          message:
            "This reservation was already converted into an order or cancelled.",
          retryable: false,
          refetch: true,
        };
      case "UNAUTHORIZED":
        return {
          title: "Signed out",
          message: "Your session expired. Sign in again.",
          retryable: false,
          refetch: false,
        };
      case "FORBIDDEN":
        return {
          title: "Not allowed",
          message: "That action isn't permitted for your account.",
          retryable: false,
          refetch: false,
        };
      case "RATE_LIMITED":
        return {
          title: "Slow down",
          message: "Too many requests. Wait a few seconds and try again.",
          retryable: true,
          refetch: false,
        };
      case "VALIDATION_ERROR":
        return {
          title: "Invalid input",
          message: err.message,
          retryable: false,
          refetch: false,
        };
      default:
        return {
          title: `Error ${err.status}`,
          message: err.message,
          retryable: err.status >= 500,
          refetch: false,
        };
    }
  }
  return {
    title: "Something went wrong",
    message: err instanceof Error ? err.message : "Unknown error",
    retryable: true,
    refetch: false,
  };
}
