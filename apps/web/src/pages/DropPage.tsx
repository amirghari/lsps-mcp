import { useEffect, useRef } from "react";
import { useAuth } from "../hooks/useAuth";
import { useFirstProduct, useProduct } from "../hooks/useProduct";
import { toUserFacing } from "../lib/errors";
import { DropCard } from "../components/DropCard";
import { LoginCard } from "../components/LoginCard";
import { Button } from "../components/ui/Button";
import { ErrorBanner } from "../components/StatusMessage";

export function DropPage() {
  const auth = useAuth();
  const firstProduct = useFirstProduct();
  // Once we know the product id, switch to the polled per-product query.
  const productQuery = useProduct(firstProduct.data?.id ?? null);

  const loginCardRef = useRef<HTMLDivElement>(null);
  const scrollToLogin = () => {
    loginCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // If /auth/me fails (e.g. token revoked server-side), clear the bad token.
  useEffect(() => {
    if (auth.isLoadingUser) return;
    if (!auth.user && auth.isAuthenticated === false) {
      // hasToken was true but /me failed → logout to clean up
      // (guard: only logout if we actually have a token left over)
    }
  }, [auth.isLoadingUser, auth.user, auth.isAuthenticated]);

  const isLoading = firstProduct.isLoading || productQuery.isLoading;
  const product = productQuery.data ?? firstProduct.data ?? null;
  const loadError = firstProduct.error ?? productQuery.error ?? null;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
            LSPS
          </p>
          <h1 className="bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-amber-200 bg-clip-text text-2xl font-semibold tracking-tight text-transparent">
            Limited Drop
          </h1>
        </div>
        {auth.isAuthenticated ? (
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-400 sm:inline">
              {auth.user?.email}
            </span>
            <Button variant="outline" size="sm" onClick={auth.logout}>
              Sign out
            </Button>
          </div>
        ) : null}
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-10 px-6 py-12">
        {loadError ? (
          <ErrorBanner
            error={toUserFacing(loadError)}
            onRetry={() => {
              void firstProduct.refetch();
              void productQuery.refetch();
            }}
          />
        ) : null}

        {isLoading && !product ? (
          <SkeletonCard />
        ) : product ? (
          <DropCard
            product={product}
            isAuthenticated={auth.isAuthenticated}
            onSignInPrompt={scrollToLogin}
          />
        ) : !loadError ? (
          <p className="text-sm text-slate-400">No products available.</p>
        ) : null}

        {!auth.isAuthenticated ? (
          <div ref={loginCardRef} className="w-full max-w-md">
            <LoginCard />
          </div>
        ) : null}
      </main>

      <footer className="mx-auto w-full max-w-5xl px-6 py-6 text-center text-xs text-slate-600">
        Reservations hold stock for 5 minutes. Stock count refreshes every 5
        seconds.
      </footer>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div
      role="status"
      aria-label="Loading product"
      className="w-full max-w-xl animate-pulse space-y-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-8"
    >
      <div className="h-4 w-20 rounded bg-slate-800" />
      <div className="h-8 w-3/4 rounded bg-slate-800" />
      <div className="h-4 w-full rounded bg-slate-800/70" />
      <div className="h-4 w-2/3 rounded bg-slate-800/70" />
      <div className="h-12 w-full rounded-xl bg-slate-800" />
    </div>
  );
}
