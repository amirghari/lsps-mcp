import type { FastifyPluginAsync } from "fastify";

const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => ({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  }));

  app.get("/health/db", async () => {
    await app.prisma.$queryRaw`SELECT 1`;
    return { status: "ok", db: "reachable" };
  });
};

export default healthRoutes;
