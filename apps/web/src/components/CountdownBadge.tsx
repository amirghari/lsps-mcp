import { cn } from "../lib/cn";

interface CountdownBadgeProps {
  mmss: string;
  secondsLeft: number;
  isExpired: boolean;
}

export function CountdownBadge({
  mmss,
  secondsLeft,
  isExpired,
}: CountdownBadgeProps) {
  const urgent = !isExpired && secondsLeft <= 30;
  return (
    <div
      role="timer"
      aria-live={urgent ? "assertive" : "polite"}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-sm tabular-nums",
        isExpired
          ? "border-rose-800/60 bg-rose-950/40 text-rose-300"
          : urgent
            ? "border-amber-700/60 bg-amber-950/40 text-amber-200 animate-pulse"
            : "border-indigo-800/60 bg-indigo-950/40 text-indigo-200",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-2 w-2 rounded-full",
          isExpired
            ? "bg-rose-400"
            : urgent
              ? "bg-amber-300"
              : "bg-indigo-300",
        )}
      />
      <span>{isExpired ? "EXPIRED" : mmss}</span>
    </div>
  );
}
