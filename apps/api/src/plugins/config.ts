import fp from "fastify-plugin";
import { loadConfig, type Config } from "../config.js";

declare module "fastify" {
  interface FastifyInstance {
    config: Config;
  }
}

export default fp(async (app) => {
  app.decorate("config", loadConfig());
});
