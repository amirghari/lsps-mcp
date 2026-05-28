import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { errors } from "../lib/errors.js";

const ListQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).max(80).optional(),
  sort: z.enum(["createdAt", "name", "priceCents", "stockAvailable"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  available: z.coerce.boolean().optional(),
});

const productRoutes: FastifyPluginAsync = async (app) => {
  app.get("/products", async (req) => {
    const q = ListQuery.parse(req.query);
    const where = {
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: "insensitive" as const } },
              { sku: { contains: q.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(q.available ? { stockAvailable: { gt: 0 } } : {}),
    };
    const [items, total] = await Promise.all([
      app.prisma.product.findMany({
        where,
        orderBy: { [q.sort]: q.order },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      app.prisma.product.count({ where }),
    ]);
    return { items, page: q.page, pageSize: q.pageSize, total };
  });

  app.get<{ Params: { id: string } }>("/products/:id", async (req) => {
    const product = await app.prisma.product.findUnique({
      where: { id: req.params.id },
    });
    if (!product) throw errors.notFound("Product not found");
    return product;
  });
};

export default productRoutes;
