import "dotenv/config";
import { PrismaClient, TransactionType, WorkspaceRole } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "bcryptjs";

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

// Two-level default category tree. Top-level keys = parent names;
// values = list of child category names. Empty array = parent with no
// children. The same shape lives in
// prisma/scripts/backfill-categories-tree.ts; keep them in sync.
const TREE: Record<TransactionType, Record<string, string[]>> = {
  EXPENSE: {
    Vehicle: [
      "Vehicle Purchase",
      "Vehicle Service",
      "Fuel",
      "Vehicle Insurance Premium",
      "Road Tax / FC / PUC",
      "Toll / Parking",
      "Toll",
      "Parking",
    ],
    Medical: [
      "Hospital",
      "Doctor consultation",
      "Medicines / Pharmacy",
      "Diagnostic / Lab",
      "Dental",
      "Vision / Eyewear",
    ],
    Household: ["Grocery", "Maid / Help", "Cooking gas (LPG)", "Repairs / Maintenance"],
    Utilities: [
      "Electricity",
      "Water",
      "Internet / Broadband",
      "Mobile / Phone",
      "DTH / Cable",
    ],
    Education: ["Fees", "Books / Stationery", "Coaching / Tuition", "Online courses"],
    "Food & Dining": ["Restaurant", "Takeaway / Delivery", "Cafe / Snacks"],
    Shopping: [
      "Clothing",
      "Electronics / Gadgets",
      "Furniture / Home",
      "Personal care",
    ],
    Travel: [
      "Flights",
      "Train",
      "Bus",
      "Auto / Rickshaw",
      "Metro / Local train",
      "Public transport pass",
      "Hotel / Stay",
      "Cab / Taxi",
      "Visa / Passport",
    ],
    Entertainment: ["Movies", "Streaming", "Games", "Events / Concerts"],
    "Insurance Premium": ["Life", "Health", "Other"],
    Tax: ["Income tax", "GST", "Property tax", "Other"],
    "Religious & Charity": ["Temple / Hundi", "Donation", "Festival expense"],
    "Personal Care": ["Salon / Beauty", "Gym / Fitness"],
    "Farm Operations": [
      "Farm Development",
      "Wage",
      "Feed",
      "Vaccination",
      "Seeds / Planting",
    ],
    "Family Events": ["Wedding", "Birthday", "Anniversary"],
    "Loan Payment": [],
    Pet: [],
    "Subscription / Membership": [],
    "Bank charges": [],
    "Gold/Jewellery": [],
    "Other Expense": [],
  },
  INCOME: {
    Salary: ["Base salary", "Bonus", "Allowances", "Reimbursement"],
    Business: ["Service revenue", "Product sale"],
    "Investment Income": ["Interest", "Dividends", "Capital gains", "Rent"],
    Agricultural: ["Crop sale", "Livestock sale", "Lease income"],
    "Asset Sale": ["Vehicle sale", "Property sale", "Gold/Jewellery sale"],
    "Gifts received": [],
    "Cashback / Rewards": [],
    "Other income": [],
  },
  INVESTMENT: {
    Equity: ["Stock", "Mutual Fund", "SIP"],
    Debt: ["FD", "RD", "Bond"],
    "Insurance (as savings)": [],
    "Gold / Precious metal": [],
    "Real Estate": [],
    Crypto: [],
    "Other Investment": [],
  },
  HAND_LOAN: {},
  TRANSFER: {},
};

async function seedDefaultCategories() {
  let createdParents = 0;
  let createdChildren = 0;
  let parentedExisting = 0;
  for (const [type, parents] of Object.entries(TREE) as [
    TransactionType,
    Record<string, string[]>,
  ][]) {
    for (const [parentName, childNames] of Object.entries(parents)) {
      // Find or create parent (workspaceId=null, isDefault=true, top-level).
      let parent = await prisma.category.findFirst({
        where: {
          name: parentName,
          isDefault: true,
          workspaceId: null,
          types: { has: type },
        },
      });
      if (!parent) {
        parent = await prisma.category.create({
          data: {
            name: parentName,
            isDefault: true,
            types: [type],
            group:
              type === "EXPENSE"
                ? "Expense"
                : type === "INCOME"
                  ? "Income"
                  : "Investment",
            parentCategoryId: null,
          },
        });
        createdParents++;
        console.log(`  + parent: ${parentName} (${type})`);
      }
      for (const childName of childNames) {
        const existing = await prisma.category.findFirst({
          where: {
            name: childName,
            isDefault: true,
            workspaceId: null,
            types: { has: type },
          },
        });
        if (existing) {
          if (existing.parentCategoryId == null) {
            await prisma.category.update({
              where: { id: existing.id },
              data: { parentCategoryId: parent.id },
            });
            parentedExisting++;
          }
        } else {
          await prisma.category.create({
            data: {
              name: childName,
              isDefault: true,
              types: [type],
              group:
                type === "EXPENSE"
                  ? "Expense"
                  : type === "INCOME"
                    ? "Income"
                    : "Investment",
              parentCategoryId: parent.id,
            },
          });
          createdChildren++;
          console.log(`    + child: ${childName} (under ${parentName})`);
        }
      }
    }
  }
  console.log(
    `  Done. Parents created: ${createdParents}, children created: ${createdChildren}, existing children re-parented: ${parentedExisting}.`,
  );
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
