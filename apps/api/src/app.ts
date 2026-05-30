import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import underPressure from "@fastify/under-pressure";
import configPlugin from "./plugins/config.js";
import prismaPlugin from "./plugins/prisma.js";
import metricsPlugin from "./plugins/metrics.js";
import errorHandler from "./plugins/errorHandler.js";
import authPlugin from "./plugins/auth.js";
import healthRoutes from "./routes/health.js";
import metricsRoutes from "./routes/metrics.js";
import productRoutes from "./routes/products.js";
import reservationRoutes from "./routes/reservations.js";
import checkoutRoutes from "./routes/checkout.js";
import authRoutes from "./routes/auth.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      transport:
        process.env.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { translateTime: "SYS:HH:MM:ss" } }
          : undefined,
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    genReqId: () =>
      `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    disableRequestLogging: false,
    trustProxy: true,
    bodyLimit: 256 * 1024,
  });

  await app.register(configPlugin);
  await app.register(sensible);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: app.config.CORS_ORIGIN.split(",").map((s) => s.trim()),
    credentials: true,
  });
  await app.register(rateLimit, {
    max: app.config.RATE_LIMIT_MAX,
    timeWindow: app.config.RATE_LIMIT_WINDOW,
    allowList: ["127.0.0.1"],
  });
  // Load shedder for production. Disabled in tests because the in-process
  // app.inject concurrency tests deliberately queue 100+ async tasks, which
  // is exactly what this plugin guards against — but those tests aren't
  // exercising HTTP throughput, they're verifying the reservation
  // transaction semantics, so the plugin gets in the way.
  //
  // `maxEventLoopDelay: 2000` gives 2× the headroom of the default 1000ms —
  // local dev briefly tripped the 1s threshold (likely IDE/GC noise) and
  // returned a 503 to the browser. In production with no pino-pretty
  // transport and no HMR rebuilds, the event loop is much quieter; 2s is a
  // safer threshold for the "no downtime" SLO without giving up the shedder.
  // Health probes go through a separate `pressureHandler` so platform
  // health checks NEVER see 503 even under genuine overload.
  if (app.config.NODE_ENV !== "test") {
    const HEALTH_PATHS = new Set(["/health", "/health/db", "/metrics"]);
    await app.register(underPressure, {
      maxEventLoopDelay: 2000,
      maxHeapUsedBytes: 768 * 1024 * 1024,
      exposeStatusRoute: false,
      retryAfter: 5,
      pressureHandler: (req, reply, _type, _value) => {
        if (HEALTH_PATHS.has(req.url)) {
          // Let health/metrics requests bypass the shedder so the platform's
          // probe doesn't mark us unhealthy and recycle the instance.
          return;
        }
        reply.status(503).send({
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Server temporarily overloaded, please retry shortly",
          },
          requestId: req.id,
        });
      },
    });
  }

  await app.register(prismaPlugin);
  await app.register(metricsPlugin);
  await app.register(authPlugin);
  await app.register(errorHandler);

  await app.register(healthRoutes);
  await app.register(metricsRoutes);
  await app.register(authRoutes, { prefix: "/api" });
  await app.register(productRoutes, { prefix: "/api" });
  await app.register(reservationRoutes, { prefix: "/api" });
  await app.register(checkoutRoutes, { prefix: "/api" });

  return app;
}
