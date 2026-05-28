import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import { errors } from "../lib/errors.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; email: string };
    user: { sub: string; email: string };
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: import("fastify").FastifyRequest) => Promise<void>;
  }
}

export default fp(async (app) => {
  await app.register(fastifyJwt, {
    secret: app.config.JWT_SECRET,
    sign: { expiresIn: app.config.JWT_EXPIRES_IN },
  });

  app.decorate("authenticate", async (req) => {
    try {
      await req.jwtVerify();
    } catch {
      throw errors.unauthorized("Invalid or missing token");
    }
  });
});
