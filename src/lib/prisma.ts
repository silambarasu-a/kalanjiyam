import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamily } from "node:net";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

setDefaultResultOrder("ipv4first");
setDefaultAutoSelectFamily(false);

const globalForPrisma = globalThis as unknown as {
  prisma: InstanceType<typeof PrismaClient> | undefined;
};

function createPrismaClient() {
  const connectionString = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;

  if (connectionString?.startsWith("prisma+postgres://")) {
    return new PrismaClient({
      accelerateUrl: connectionString,
    });
  }

  const adapter = new PrismaPg({
    connectionString,
    idleTimeoutMillis: 60_000,
    max: 10,
  });
  return new PrismaClient({ adapter });
}

const isFreshClient = !globalForPrisma.prisma;
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

if (isFreshClient) {
  prisma.$queryRaw`SELECT 1`.catch(() => {});
}
