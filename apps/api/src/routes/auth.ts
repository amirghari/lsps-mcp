import type { FastifyPluginAsync } from "fastify";
import { AuthLoginRequest, AuthRegisterRequest } from "@lsps/types";
import { hashPassword, verifyPassword } from "../lib/passwords.js";
import { errors } from "../lib/errors.js";

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/auth/register", async (req, reply) => {
    const body = AuthRegisterRequest.parse(req.body);
    const existing = await app.prisma.user.findUnique({
      where: { email: body.email },
    });
    if (existing) throw errors.conflict("Email already registered");
    const user = await app.prisma.user.create({
      data: {
        email: body.email,
        passwordHash: await hashPassword(body.password),
        displayName: body.displayName ?? null,
      },
    });
    const token = app.jwt.sign({ sub: user.id, email: user.email });
    return reply.status(201).send({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
    });
  });

  app.post("/auth/login", async (req) => {
    const body = AuthLoginRequest.parse(req.body);
    const user = await app.prisma.user.findUnique({
      where: { email: body.email },
    });
    if (!user) throw errors.unauthorized("Invalid credentials");
    const valid = await verifyPassword(body.password, user.passwordHash);
    if (!valid) throw errors.unauthorized("Invalid credentials");
    const token = app.jwt.sign({ sub: user.id, email: user.email });
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
    };
  });

  app.get(
    "/auth/me",
    { preHandler: app.authenticate },
    async (req) => {
      const user = await app.prisma.user.findUnique({
        where: { id: req.user.sub },
      });
      if (!user) throw errors.unauthorized();
      return { id: user.id, email: user.email, displayName: user.displayName };
    },
  );
};

export default authRoutes;
