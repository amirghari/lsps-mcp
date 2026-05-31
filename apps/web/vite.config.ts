import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Vite by default looks for .env files in the project root (apps/web/).
// In our monorepo + Pxxl deploy, env vars land at the workspace root
// (/app/.env on Pxxl), so we point envDir there explicitly.
const here = dirname(fileURLToPath(import.meta.url));
const envDir = resolve(here, "../..");

export default defineConfig({
  plugins: [react()],
  envDir,
  server: {
    port: 5173,
    host: true,
  },
  preview: {
    port: 4173,
    host: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
