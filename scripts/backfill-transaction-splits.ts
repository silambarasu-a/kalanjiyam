/**
 * Backfill TransactionSplit rows from the legacy single-beneficiary model.
 *
 * Historical context: Slice 1 added TransactionSplit and ran this script to
 * mirror every existing `beneficiaryContactId` row into a split. Slice 3
 * later dropped `Transaction.memberChargeId`, so this script now keys
 * recoverability off the `memberChargeType` column instead. Kept here so
 * a fresh clone can re-run it idempotently if the splits table is empty.
 *
 * Run with: npx tsx scripts/backfill-transaction-splits.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const txns = await prisma.transaction.findMany({
    where: {
      type: { in: ["EXPENSE", "TRANSFER"] },
      beneficiaryContactId: { not: null },
    },
    select: {
      id: true,
      workspaceId: true,
      amount: true,
      beneficiaryContactId: true,
      memberChargeType: true,
    },
  });

  let created = 0;
  let skipped = 0;

  for (const t of txns) {
    if (!t.beneficiaryContactId) continue;

    const existing = await prisma.transactionSplit.findUnique({
      where: {
        transactionId_contactId: {
          transactionId: t.id,
          contactId: t.beneficiaryContactId,
        },
      },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    const isRecoverable = t.memberChargeType === "RECOVERABLE";

    await prisma.transactionSplit.create({
      data: {
        workspaceId: t.workspaceId,
        transactionId: t.id,
        contactId: t.beneficiaryContactId,
        amount: t.amount,
        isRecoverable,
      },
    });
    created++;
  }

  console.log(`Backfill complete. Created: ${created}. Skipped (already existed): ${skipped}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
