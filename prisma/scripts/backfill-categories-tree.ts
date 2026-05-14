/**
 * Idempotent backfill for the new two-level Category hierarchy.
 *
 *  - Reads → diffs → writes only what's missing.
 *  - Operates ONLY on default rows (workspaceId IS NULL, isDefault=true).
 *    Custom workspace categories are never touched.
 *  - For each existing default child whose parentCategoryId is NULL,
 *    sets it to the matching parent. Never overwrites a non-NULL value.
 *  - For each missing default (parent or child), inserts a new row.
 *  - Never mutates Transaction rows — every transaction's categoryId
 *    keeps pointing at the same Category id it always did.
 *
 * Run with:
 *   npx tsx prisma/scripts/backfill-categories-tree.ts
 *
 * Safe to re-run any number of times; subsequent runs are no-ops.
 */
import "dotenv/config";
import { prisma } from "../../src/lib/prisma";
import type { TransactionType } from "../../src/generated/prisma/client";

type Tree = Record<TransactionType, Record<string, string[]>>;

const TREE: Tree = {
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
    // standalone parents
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

async function main() {
  let createdParents = 0;
  let createdChildren = 0;
  let parentedExisting = 0;
  let alreadyParented = 0;

  for (const [type, parents] of Object.entries(TREE) as [
    TransactionType,
    Record<string, string[]>,
  ][]) {
    for (const [parentName, childNames] of Object.entries(parents)) {
      // Step 1 — find or create the top-level parent (workspaceId=null, isDefault=true)
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
            // Keep `group` aligned with the type so the legacy UI keeps
            // its grouping label intact for clients that haven't moved
            // to the parentCategoryId model yet.
            group: type === "EXPENSE" ? "Expense" : type === "INCOME" ? "Income" : "Investment",
            parentCategoryId: null,
          },
        });
        createdParents++;
      }

      // Step 2 — for each child: re-parent existing OR insert new
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
          } else {
            alreadyParented++;
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
        }
      }
    }
  }

  console.log(
    `[backfill] parents created: ${createdParents}, ` +
      `children created: ${createdChildren}, ` +
      `existing children re-parented: ${parentedExisting}, ` +
      `already-parented: ${alreadyParented}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
