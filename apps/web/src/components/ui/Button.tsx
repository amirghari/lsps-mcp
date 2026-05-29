import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "ghost" | "outline" | "success" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variantClass: Record<Variant, string> = {
  primary:
    "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 hover:bg-indigo-400 active:bg-indigo-600 disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none",
  ghost:
    "bg-transparent text-slate-200 hover:bg-slate-800 active:bg-slate-700 disabled:text-slate-500",
  outline:
    "border border-slate-700 bg-slate-900/40 text-slate-200 hover:bg-slate-800 active:bg-slate-700 disabled:opacity-50",
  success:
    "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 active:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-400",
  danger:
    "bg-rose-500 text-white shadow-lg shadow-rose-500/20 hover:bg-rose-400 active:bg-rose-600 disabled:bg-slate-700 disabled:text-slate-400",
};

const sizeClass: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2.5 text-sm",
  lg: "px-5 py-3 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed",
          variantClass[variant],
          sizeClass[size],
          className,
        )}
        {...rest}
      >
        {loading ? (
          <span
            aria-hidden
            className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
          />
        ) : null}
        {children}
      </button>
    );
  },
);
