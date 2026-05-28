import type { FastifyPluginAsync } from "fastify";
import { ReserveRequest } from "@lsps/types";
import { reserve } from "../services/reservations.js";

const reservationRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/reserve",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const body = ReserveRequest.parse(req.body);
      const result = await reserve(app, {
        userId: req.user.sub,
        productId: body.productId,
        quantity: body.quantity,
      });
      return reply.status(201).send(result);
    },
  );
};

export default reservationRoutes;
