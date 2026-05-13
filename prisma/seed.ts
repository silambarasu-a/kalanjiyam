import "dotenv/config";
import { PrismaClient, TransactionType, WorkspaceRole } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "bcryptjs";

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

type CategoryDef = {
  name: string;
  types: TransactionType[];
  group?: string;
  icon?: string;
};

const DEFAULT_CATEGORIES: CategoryDef[] = [
  // Income
  { name: "Salary", types: [TransactionType.INCOME], group: "Income" },
  { name: "Interest", types: [TransactionType.INCOME], group: "Income" },
  { name: "Agri Income", types: [TransactionType.INCOME], group: "Income" },
  { name: "Lease Income", types: [TransactionType.INCOME], group: "Income" },
  { name: "Other Income", types: [TransactionType.INCOME], group: "Income" },

  // Expense
  { name: "Household", types: [TransactionType.EXPENSE], group: "Expense" },
  { name: "Grocery", types: [TransactionType.EXPENSE], group: "Expense" },
  { name: "Farm Development", types: [TransactionType.EXPENSE], group: "Expense" },
  { name: "Wage", types: [TransactionType.EXPENSE], group: "Expense" },
  { name: "Feed", types: [TransactionType.EXPENSE], group: "Expense" },
  { name: "Vaccination", types: [TransactionType.EXPENSE], group: "Expense" },
  { name: "Loan Payment", types: [TransactionType.EXPENSE], group: "Expense" },
  { name: "Vehicle Purchase", types: [TransactionType.EXPENSE], group: "Expense" },
  { name: "Vehicle Service", types: [TransactionType.EXPENSE], group: "Expense" },
  { name: "Fuel", types: [TransactionType.EXPENSE], group: "Expense" },
  { name: "Hospital", types: [TransactionType.EXPENSE], group: "Expense" },
  { name: "Gold/Jewellery", types: [TransactionType.EXPENSE], group: "Expense" },
  { name: "Other Expense", types: [TransactionType.EXPENSE], group: "Expense" },

  // Investment
  { name: "SIP", types: [TransactionType.INVESTMENT], group: "Investment" },
  { name: "FD", types: [TransactionType.INVESTMENT], group: "Investment" },
  { name: "RD", types: [TransactionType.INVESTMENT], group: "Investment" },
  { name: "Insurance", types: [TransactionType.INVESTMENT], group: "Investment" },
  { name: "Stock", types: [TransactionType.INVESTMENT], group: "Investment" },
  { name: "Mutual Fund", types: [TransactionType.INVESTMENT], group: "Investment" },
  { name: "Gold", types: [TransactionType.INVESTMENT], group: "Investment" },
];

async function seedDefaultCategories() {
  for (const def of DEFAULT_CATEGORIES) {
    const existing = await prisma.category.findFirst({
      where: { name: def.name, workspaceId: null, isDefault: true },
    });
    if (existing) continue;
    await prisma.category.create({
      data: {
        name: def.name,
        types: def.types,
        group: def.group,
        icon: def.icon,
        isDefault: true,
      },
    });
    console.log(`  + default category: ${def.name}`);
  }
}

async function seedDevUser() {
  if (process.env.NODE_ENV === "production") return;
  const email = "ramon@starlightmusic.com";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`  dev user already exists: ${email}`);
    return;
  }

  const passwordHash = await hash("Kalanjiyam@123", 12);
  const user = await prisma.user.create({
    data: {
      name: "Ramon",
      email,
      emailVerified: new Date(),
      passwordHash,
    },
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: "My Workspace",
      ownerUserId: user.id,
    },
  });

  await prisma.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      role: WorkspaceRole.OWNER,
      acceptedAt: new Date(),
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { activeWorkspaceId: workspace.id },
  });

  console.log(`  + dev user ${email} + workspace "My Workspace"`);
}

async function main() {
  console.log("Seeding default categories...");
  await seedDefaultCategories();
  console.log("Seeding dev user (dev only)...");
  await seedDevUser();
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
