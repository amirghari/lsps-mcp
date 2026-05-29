import { useState, type FormEvent } from "react";
import { useAuth } from "../hooks/useAuth";
import { toUserFacing } from "../lib/errors";
import { Button } from "./ui/Button";
import { StatusMessage } from "./StatusMessage";

type Mode = "login" | "register";

export function LoginCard() {
  const { login, register, isAuthenticating, loginError, registerError } =
    useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const activeError = mode === "login" ? loginError : registerError;
  const ufe = activeError ? toUserFacing(activeError) : null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === "login") {
      await login({ email, password }).catch(() => {});
    } else {
      await register({
        email,
        password,
        ...(displayName ? { displayName } : {}),
      }).catch(() => {});
    }
  };

  return (
    <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-2xl shadow-indigo-500/5 backdrop-blur">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-slate-100">
          {mode === "login" ? "Sign in" : "Create account"}
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          {mode === "login"
            ? "Sign in to reserve a unit of the drop."
            : "Pick any email — this is a demo."}
        </p>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
            Email
          </span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            placeholder="you@lsps.test"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
            Password
          </span>
          <input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            placeholder="At least 8 characters"
          />
        </label>

        {mode === "register" ? (
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Display name (optional)
            </span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              placeholder="Demo User"
            />
          </label>
        ) : null}

        {ufe ? (
          <StatusMessage tone="error" title={ufe.title} message={ufe.message} />
        ) : null}

        <Button
          type="submit"
          size="lg"
          loading={isAuthenticating}
          className="w-full"
        >
          {mode === "login" ? "Sign in" : "Create account & sign in"}
        </Button>
      </form>

      <div className="mt-6 text-center text-xs text-slate-500">
        {mode === "login" ? (
          <>
            New here?{" "}
            <button
              type="button"
              className="font-medium text-indigo-300 hover:text-indigo-200"
              onClick={() => setMode("register")}
            >
              Create an account
            </button>
          </>
        ) : (
          <>
            Already registered?{" "}
            <button
              type="button"
              className="font-medium text-indigo-300 hover:text-indigo-200"
              onClick={() => setMode("login")}
            >
              Sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
