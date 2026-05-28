export function DropPage() {
  return (
    <section className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-16">
      <h1 className="bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-amber-200 bg-clip-text text-5xl font-semibold tracking-tight text-transparent">
        LSPS Drop
      </h1>
      <p className="mt-4 text-center text-slate-300">
        Limited Stock Product System.
        <br />
        Reservation logic and live polling land on Day 3.
      </p>
      <div className="mt-12 w-full rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-2xl shadow-indigo-500/5 backdrop-blur">
        <div className="flex items-baseline justify-between">
          <span className="text-sm uppercase tracking-widest text-slate-500">
            DROP-001
          </span>
          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-400">
            scaffold
          </span>
        </div>
        <h2 className="mt-2 text-2xl font-semibold">Test Item</h2>
        <p className="mt-1 text-slate-400">
          Stock counter, reserve button, countdown timer, and edge-case handling
          will live here.
        </p>
        <button
          type="button"
          disabled
          className="mt-6 w-full cursor-not-allowed rounded-xl bg-indigo-500/30 px-4 py-3 text-sm font-medium text-slate-300"
        >
          Reserve (disabled — wiring up)
        </button>
      </div>
    </section>
  );
}
