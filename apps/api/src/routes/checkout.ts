import type { FastifyPluginAsync } from "fastify";
import { CheckoutRequest } from "@lsps/types";
import { checkout } from "../services/reservations.js";

const checkoutRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/checkout",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const body = CheckoutRequest.parse(req.body);
      const result = await checkout(app, {
        userId: req.user.sub,
        reservationId: body.reservationId,
      });
      return reply.status(201).send(result);
    },
  );
};

export default checkoutRoutes;
