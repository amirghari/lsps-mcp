import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    env: {
      // Tests target the lsps_test database; created once via
      //   docker exec lsps-postgres psql -U lsps -d postgres -c "CREATE DATABASE lsps_test OWNER lsps;"
      // connection_limit lifted from default (~21 on this box) to comfortably
      // exceed the 100-parallel stress test without starving Prisma.
      DATABASE_URL:
        "postgresql://lsps:lsps_dev@localhost:5433/lsps_test?schema=public&connection_limit=40&pool_timeout=30",
      JWT_SECRET: "test-secret-must-be-at-least-16-chars",
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      // Short TTL so the expiry test can wait it out without slowing the suite.
      RESERVATION_TTL_SECONDS: "1",
      EXPIRY_SWEEP_INTERVAL_SECONDS: "60",
      CORS_ORIGIN: "http://localhost:5173",
      RATE_LIMIT_MAX: "10000",
      RATE_LIMIT_WINDOW: "1 minute",
    },
  },
});
