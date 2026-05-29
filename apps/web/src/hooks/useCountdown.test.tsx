import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCountdown } from "./useCountdown";

describe("useCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-29T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts at full TTL when expiresAt is in the future", () => {
    const expiresAt = new Date("2026-05-29T12:05:00.000Z").toISOString();
    const { result } = renderHook(() => useCountdown(expiresAt));
    expect(result.current.secondsLeft).toBe(300);
    expect(result.current.mmss).toBe("05:00");
    expect(result.current.isExpired).toBe(false);
  });

  it("ticks down by one second on each interval", () => {
    const expiresAt = new Date("2026-05-29T12:05:00.000Z").toISOString();
    const { result } = renderHook(() => useCountdown(expiresAt));

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.mmss).toBe("04:59");

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.mmss).toBe("03:59");
    expect(result.current.isExpired).toBe(false);
  });

  it("transitions to isExpired=true at zero", () => {
    const expiresAt = new Date("2026-05-29T12:00:03.000Z").toISOString();
    const { result } = renderHook(() => useCountdown(expiresAt));
    expect(result.current.secondsLeft).toBe(3);

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current.secondsLeft).toBe(0);
    expect(result.current.isExpired).toBe(true);
    expect(result.current.mmss).toBe("00:00");
  });

  it("stops scheduling timers after expiry (no further ticks)", () => {
    const expiresAt = new Date("2026-05-29T12:00:02.000Z").toISOString();
    const { result } = renderHook(() => useCountdown(expiresAt));

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current.isExpired).toBe(true);

    // Advancing further must not throw, must not flip back to non-expired.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.isExpired).toBe(true);
    expect(result.current.secondsLeft).toBe(0);
  });

  it("returns an expired state when given null", () => {
    const { result } = renderHook(() => useCountdown(null));
    expect(result.current.isExpired).toBe(true);
    expect(result.current.secondsLeft).toBe(0);
    expect(result.current.mmss).toBe("00:00");
  });

  it("returns an expired state when expiresAt is already in the past", () => {
    const expiresAt = new Date("2026-05-29T11:59:00.000Z").toISOString();
    const { result } = renderHook(() => useCountdown(expiresAt));
    expect(result.current.isExpired).toBe(true);
    expect(result.current.secondsLeft).toBe(0);
  });

  it("resets when expiresAt changes (new reservation)", () => {
    const first = new Date("2026-05-29T12:00:30.000Z").toISOString();
    const { result, rerender } = renderHook(({ at }) => useCountdown(at), {
      initialProps: { at: first },
    });
    expect(result.current.secondsLeft).toBe(30);

    const second = new Date("2026-05-29T12:05:00.000Z").toISOString();
    rerender({ at: second });
    expect(result.current.secondsLeft).toBe(300);
    expect(result.current.isExpired).toBe(false);
  });
});
