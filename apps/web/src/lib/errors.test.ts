import { describe, expect, it } from "vitest";
import {
  ApiNetworkError,
  ApiRequestError,
  ApiTimeoutError,
} from "../api/client";
import { toUserFacing } from "./errors";

function apiErr(code: string, status = 409) {
  return new ApiRequestError(status, {
    error: { code, message: "msg" },
  });
}

describe("toUserFacing", () => {
  it("maps OUT_OF_STOCK to a sold-out message with refetch=true", () => {
    const ufe = toUserFacing(apiErr("OUT_OF_STOCK"));
    expect(ufe.title).toMatch(/sold out/i);
    expect(ufe.refetch).toBe(true);
    expect(ufe.retryable).toBe(false);
  });

  it("maps DUPLICATE_RESERVATION to an 'already reserved' message", () => {
    const ufe = toUserFacing(apiErr("DUPLICATE_RESERVATION"));
    expect(ufe.title).toMatch(/already reserved/i);
    expect(ufe.refetch).toBe(true);
  });

  it("maps RESERVATION_EXPIRED with retryable=false", () => {
    const ufe = toUserFacing(apiErr("RESERVATION_EXPIRED", 410));
    expect(ufe.title).toMatch(/expired/i);
    expect(ufe.retryable).toBe(false);
    expect(ufe.refetch).toBe(true);
  });

  it("maps UNAUTHORIZED to a sign-in prompt", () => {
    const ufe = toUserFacing(apiErr("UNAUTHORIZED", 401));
    expect(ufe.title).toMatch(/signed out|sign/i);
    expect(ufe.refetch).toBe(false);
  });

  it("maps RATE_LIMITED to retryable=true", () => {
    const ufe = toUserFacing(apiErr("RATE_LIMITED", 429));
    expect(ufe.retryable).toBe(true);
  });

  it("maps ApiTimeoutError to a 'server is slow' message, retryable", () => {
    const ufe = toUserFacing(new ApiTimeoutError(8000));
    expect(ufe.title).toMatch(/slow/i);
    expect(ufe.retryable).toBe(true);
  });

  it("maps ApiNetworkError to an offline message, retryable", () => {
    const ufe = toUserFacing(new ApiNetworkError(new Error("x")));
    expect(ufe.title).toMatch(/offline/i);
    expect(ufe.retryable).toBe(true);
    expect(ufe.refetch).toBe(false);
  });

  it("unknown 5xx falls through to retryable=true generic", () => {
    const ufe = toUserFacing(apiErr("WHATEVER", 503));
    expect(ufe.retryable).toBe(true);
  });

  it("unknown 4xx falls through to retryable=false generic", () => {
    const ufe = toUserFacing(apiErr("WHATEVER", 418));
    expect(ufe.retryable).toBe(false);
  });

  it("non-Error objects produce a safe fallback", () => {
    const ufe = toUserFacing("just a string");
    expect(ufe.title).toBeDefined();
    expect(ufe.retryable).toBe(true);
  });
});
