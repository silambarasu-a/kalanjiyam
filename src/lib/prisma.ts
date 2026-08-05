import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamily } from "node:net";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

setDefaultResultOrder("ipv4first");
setDefaultAutoSelectFamily(false);

const globalForPrisma = globalThis as unknown as {
  prisma: InstanceType<typeof PrismaClient> | undefined;
};

// The two branches instantiate PrismaClient with different option generics;
// without the explicit return type the result is a union of two client
// types, and method resolution on that union intermittently blows TS's
// instantiation depth (TS2321 "excessive stack depth") at arbitrary query
// sites. Collapsing to the default-args instance type here fixes all of
// them at once.
function createPrismaClient(): InstanceType<typeof PrismaClient> {
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
