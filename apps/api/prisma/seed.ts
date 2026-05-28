import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();

async function main() {
  // Demo product for the limited drop page.
  const sku = "DROP-001";
  const stock = 50;
  const existing = await prisma.product.findUnique({ where: { sku } });
  if (existing) {
    console.log(`Product ${sku} already exists, resetting stock to ${stock}.`);
    await prisma.product.update({
      where: { sku },
      data: { stockTotal: stock, stockAvailable: stock },
    });
  } else {
    await prisma.product.create({
      data: {
        id: randomUUID(),
        sku,
        name: "LSPS Drop — Test Item",
        description:
          "Limited-stock test product. Reserve to hold stock for 5 minutes.",
        priceCents: 4999,
        currency: "EUR",
        stockTotal: stock,
        stockAvailable: stock,
        dropAt: new Date(),
      },
    });
    console.log(`Seeded product ${sku} with stock=${stock}.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
