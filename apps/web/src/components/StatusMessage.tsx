import { cn } from "../lib/cn";
import type { UserFacingError } from "../lib/errors";

type Tone = "error" | "info" | "success" | "warn";

interface StatusMessageProps {
  tone?: Tone;
  title: string;
  message?: string;
  onDismiss?: () => void;
  onRetry?: () => void;
  retryLabel?: string;
}

const toneClass: Record<Tone, string> = {
  error: "border-rose-800/60 bg-rose-950/30 text-rose-100",
  warn: "border-amber-800/60 bg-amber-950/30 text-amber-100",
  info: "border-slate-700 bg-slate-900/40 text-slate-200",
  success: "border-emerald-800/60 bg-emerald-950/30 text-emerald-100",
};

export function StatusMessage({
  tone = "info",
  title,
  message,
  onDismiss,
  onRetry,
  retryLabel = "Retry",
}: StatusMessageProps) {
  return (
    <div
      role={tone === "error" || tone === "warn" ? "alert" : "status"}
      className={cn("rounded-xl border p-4", toneClass[tone])}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-semibold">{title}</p>
          {message ? (
            <p className="text-sm leading-relaxed opacity-90">{message}</p>
          ) : null}
        </div>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="rounded-md p-1 text-current opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        ) : null}
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md border border-current px-3 py-1 text-xs font-medium opacity-80 hover:opacity-100"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

export function ErrorBanner({
  error,
  onDismiss,
  onRetry,
}: {
  error: UserFacingError;
  onDismiss?: () => void;
  onRetry?: () => void;
}) {
  return (
    <StatusMessage
      tone="error"
      title={error.title}
      message={error.message}
      onDismiss={onDismiss}
      onRetry={error.retryable ? onRetry : undefined}
    />
  );
}
