import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiNetworkError,
  ApiRequestError,
  ApiTimeoutError,
  api,
  getToken,
  setToken,
} from "./client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api client", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
    setToken(null);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setToken(null);
  });

  it("returns the parsed JSON body on 2xx", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const data = await api<{ ok: boolean }>("/x", { auth: false });
    expect(data).toEqual({ ok: true });
  });

  it("attaches Bearer token when auth=true and token present", async () => {
    setToken("the-token");
    fetchSpy.mockResolvedValueOnce(jsonResponse({}));
    await api("/x");
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer the-token");
  });

  it("omits Bearer when auth=false", async () => {
    setToken("the-token");
    fetchSpy.mockResolvedValueOnce(jsonResponse({}));
    await api("/x", { auth: false });
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("throws ApiRequestError with the server's error envelope on 4xx", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        {
          error: { code: "OUT_OF_STOCK", message: "Only 0 left" },
          requestId: "r-1",
        },
        409,
      ),
    );

    await expect(api("/reserve", { method: "POST", body: {} })).rejects.toThrow(
      ApiRequestError,
    );

    try {
      await api("/reserve", { method: "POST", body: {} });
    } catch {
      // first attempt already failed; ignore
    }
  });

  it("preserves the error code on ApiRequestError so callers can branch", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "DUPLICATE_RESERVATION", message: "dup" } },
        409,
      ),
    );
    try {
      await api("/reserve", { method: "POST", body: {} });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiRequestError);
      expect((err as ApiRequestError).code).toBe("DUPLICATE_RESERVATION");
      expect((err as ApiRequestError).status).toBe(409);
    }
  });

  it("throws ApiNetworkError when fetch rejects", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(api("/x", { auth: false })).rejects.toBeInstanceOf(
      ApiNetworkError,
    );
  });

  it("throws ApiTimeoutError when the request exceeds timeoutMs", async () => {
    // fetch never resolves; the timeout fires and aborts.
    fetchSpy.mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        }),
    );

    vi.useFakeTimers();
    const promise = api("/slow", { auth: false, timeoutMs: 200 });
    vi.advanceTimersByTime(201);
    await expect(promise).rejects.toBeInstanceOf(ApiTimeoutError);
    vi.useRealTimers();
  });

  it("returns undefined on 204 No Content", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const data = await api("/x", { auth: false });
    expect(data).toBeUndefined();
  });

  it("getToken/setToken round-trip via localStorage", () => {
    expect(getToken()).toBeNull();
    setToken("abc");
    expect(getToken()).toBe("abc");
    setToken(null);
    expect(getToken()).toBeNull();
  });
});
