import type { FastifyPluginAsync } from "fastify";

const metricsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/metrics", async (_req, reply) => {
    reply.header("Content-Type", app.metrics.registry.contentType);
    return app.metrics.registry.metrics();
  });
};

export default metricsRoutes;
