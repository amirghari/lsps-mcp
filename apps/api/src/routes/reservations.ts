import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ReservationStatus } from "@prisma/client";
import { ReserveRequest } from "@lsps/types";
import { reserve } from "../services/reservations.js";
import { errors } from "../lib/errors.js";

const ListQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: z.nativeEnum(ReservationStatus).optional(),
  productId: z.string().uuid().optional(),
  sort: z.enum(["createdAt", "expiresAt", "status"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

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

  // List the caller's reservations. Used by the frontend to recover an active
  // reservation after a hard refresh and to render reservation history.
  app.get(
    "/reservations",
    { preHandler: app.authenticate },
    async (req) => {
      const q = ListQuery.parse(req.query);
      const where = {
        userId: req.user.sub,
        ...(q.status ? { status: q.status } : {}),
        ...(q.productId ? { productId: q.productId } : {}),
      };
      const [items, total] = await Promise.all([
        app.prisma.reservation.findMany({
          where,
          orderBy: { [q.sort]: q.order },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        app.prisma.reservation.count({ where }),
      ]);
      return { items, page: q.page, pageSize: q.pageSize, total };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/reservations/:id",
    { preHandler: app.authenticate },
    async (req) => {
      const r = await app.prisma.reservation.findUnique({
        where: { id: req.params.id },
      });
      if (!r) throw errors.notFound("Reservation not found");
      if (r.userId !== req.user.sub) throw errors.forbidden();
      return r;
    },
  );
};

export default reservationRoutes;
