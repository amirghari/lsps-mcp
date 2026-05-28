import fp from "fastify-plugin";
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

declare module "fastify" {
  interface FastifyInstance {
    metrics: {
      registry: Registry;
      httpRequests: Counter<string>;
      httpDuration: Histogram<string>;
      reservationsCreated: Counter<string>;
      reservationsExpired: Counter<string>;
      reservationsCheckedOut: Counter<string>;
      outOfStockRejections: Counter<string>;
    };
  }
}

export default fp(async (app) => {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const httpRequests = new Counter({
    name: "lsps_http_requests_total",
    help: "Total HTTP requests",
    labelNames: ["method", "route", "status"],
    registers: [registry],
  });
  const httpDuration = new Histogram({
    name: "lsps_http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });
  const reservationsCreated = new Counter({
    name: "lsps_reservations_created_total",
    help: "Reservations successfully created",
    labelNames: ["product_sku"],
    registers: [registry],
  });
  const reservationsExpired = new Counter({
    name: "lsps_reservations_expired_total",
    help: "Reservations expired by the sweeper",
    registers: [registry],
  });
  const reservationsCheckedOut = new Counter({
    name: "lsps_reservations_checked_out_total",
    help: "Reservations converted to orders",
    labelNames: ["product_sku"],
    registers: [registry],
  });
  const outOfStockRejections = new Counter({
    name: "lsps_out_of_stock_rejections_total",
    help: "Reserve attempts rejected due to insufficient stock",
    labelNames: ["product_sku"],
    registers: [registry],
  });

  app.decorate("metrics", {
    registry,
    httpRequests,
    httpDuration,
    reservationsCreated,
    reservationsExpired,
    reservationsCheckedOut,
    outOfStockRejections,
  });

  app.addHook("onResponse", async (req, reply) => {
    const route = req.routeOptions?.url ?? req.url;
    const labels = {
      method: req.method,
      route,
      status: String(reply.statusCode),
    };
    httpRequests.inc(labels);
    httpDuration.observe(labels, reply.elapsedTime / 1000);
  });
});
