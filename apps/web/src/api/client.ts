import type { ApiError } from "@lsps/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

const TOKEN_KEY = "lsps_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/**
 * Server replied with a non-2xx and a structured error envelope.
 * The body's `error.code` is the source of truth for what failed
 * (e.g. OUT_OF_STOCK, DUPLICATE_RESERVATION, RESERVATION_EXPIRED).
 */
export class ApiRequestError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;
  constructor(status: number, payload: ApiError) {
    super(payload.error.message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = payload.error.code;
    this.details = payload.error.details;
  }
}

/** Request was aborted by our own timeout (NOT a user-initiated cancel). */
export class ApiTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "ApiTimeoutError";
  }
}

/** fetch() itself rejected — server unreachable, DNS failure, offline, etc. */
export class ApiNetworkError extends Error {
  constructor(cause: unknown) {
    super("Network error");
    this.name = "ApiNetworkError";
    this.cause = cause;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  signal?: AbortSignal;
  auth?: boolean;
  timeoutMs?: number;
}

export async function api<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const {
    method = "GET",
    body,
    signal,
    auth = true,
    timeoutMs = 8_000,
  } = opts;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  // Outer signal abort (e.g. component unmount) cancels too.
  let externalAbort = false;
  if (signal) {
    const onAbort = () => {
      externalAbort = true;
      controller.abort();
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (timedOut) throw new ApiTimeoutError(timeoutMs);
      if (externalAbort) throw err; // let caller decide; AbortError bubbles
      throw new ApiNetworkError(err);
    }

    if (res.status === 204) return undefined as T;

    // Some 5xx responses may not be JSON. Tolerate both.
    const text = await res.text();
    const payload = text ? (JSON.parse(text) as unknown) : null;

    if (!res.ok) {
      if (payload && typeof payload === "object" && "error" in payload) {
        throw new ApiRequestError(res.status, payload as ApiError);
      }
      throw new ApiRequestError(res.status, {
        error: {
          code: "UNKNOWN",
          message: `HTTP ${res.status}`,
        },
      });
    }
    return payload as T;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
