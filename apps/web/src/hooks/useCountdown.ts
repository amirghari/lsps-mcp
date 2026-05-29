import { useEffect, useState } from "react";

export interface CountdownState {
  secondsLeft: number;
  /** Pretty `mm:ss` like `04:32`. Always two digits each side. */
  mmss: string;
  isExpired: boolean;
}

function computeState(expiresAt: Date | null, nowMs: number): CountdownState {
  if (!expiresAt) {
    return { secondsLeft: 0, mmss: "00:00", isExpired: true };
  }
  const diffMs = expiresAt.getTime() - nowMs;
  const secondsLeft = Math.max(0, Math.ceil(diffMs / 1000));
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  const mmss = `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return { secondsLeft, mmss, isExpired: secondsLeft <= 0 };
}

/**
 * 1 Hz countdown to a fixed instant. Re-renders the component once per second
 * until `expiresAt` is reached; then the interval is cleared and no further
 * renders happen. Pass `null` to disable the timer entirely (e.g. no
 * reservation yet) — the hook will return an expired state without scheduling.
 */
export function useCountdown(expiresAt: string | Date | null): CountdownState {
  const target =
    expiresAt instanceof Date
      ? expiresAt
      : expiresAt
        ? new Date(expiresAt)
        : null;

  const [state, setState] = useState<CountdownState>(() =>
    computeState(target, Date.now()),
  );

  useEffect(() => {
    if (!target) {
      setState({ secondsLeft: 0, mmss: "00:00", isExpired: true });
      return;
    }
    // Recompute immediately when the target changes (handles a new reservation).
    setState(computeState(target, Date.now()));

    if (target.getTime() <= Date.now()) return; // already expired, no interval

    const id = window.setInterval(() => {
      const next = computeState(target, Date.now());
      setState(next);
      if (next.isExpired) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [target?.getTime()]);

  return state;
}
