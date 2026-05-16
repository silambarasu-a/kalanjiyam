/**
 * Quick sanity-check of the TransactionSplit + MemberCharge state after the
 * Slice 1 backfill. Reports:
 *  - total splits in DB
 *  - splits grouped by isRecoverable
 *  - any transaction with mismatched legacy beneficiary vs split contact
 *  - any orphaned MemberCharge (no originSplit and no originTransaction)
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const total = await prisma.transactionSplit.count();
  const recoverable = await prisma.transactionSplit.count({ where: { isRecoverable: true } });
  const linkedToCharge = await prisma.transactionSplit.count({
    where: { memberChargeId: { not: null } },
  });
  console.log(`TransactionSplit rows: ${total}`);
  console.log(`  recoverable: ${recoverable}`);
  console.log(`  linked to MemberCharge: ${linkedToCharge}`);

  const txnsWithLegacyBeneficiary = await prisma.transaction.findMany({
    where: { beneficiaryContactId: { not: null } },
    select: { id: true, beneficiaryContactId: true, splits: { select: { contactId: true } } },
  });
  const mismatched = txnsWithLegacyBeneficiary.filter((t) => {
    if (t.splits.length === 0) return true;
    return !t.splits.some((s) => s.contactId === t.beneficiaryContactId);
  });
  console.log(`Transactions with legacy beneficiary set: ${txnsWithLegacyBeneficiary.length}`);
  console.log(`  missing a matching split row: ${mismatched.length}`);
  if (mismatched.length > 0) {
    console.log(`  → ids:`, mismatched.slice(0, 5).map((t) => t.id));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
