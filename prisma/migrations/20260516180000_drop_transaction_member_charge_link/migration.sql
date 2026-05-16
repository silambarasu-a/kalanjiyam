-- Slice 3 cleanup: drop the legacy 1:1 Transaction <-> MemberCharge link.
-- TransactionSplit is now the only path between a transaction and its
-- charges. The 2 rows with non-null memberChargeId have matching
-- TransactionSplit rows pointing at the same MemberCharge — verified
-- before running.

-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT IF EXISTS "Transaction_memberChargeId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "Transaction_memberChargeId_key";

-- DropColumn
ALTER TABLE "Transaction" DROP COLUMN IF EXISTS "memberChargeId";

-- Tighten MemberCharge.beneficiaryContact onDelete: Cascade -> Restrict
-- so you can't accidentally wipe charges by deleting a contact.
ALTER TABLE "MemberCharge" DROP CONSTRAINT IF EXISTS "MemberCharge_beneficiaryContactId_fkey";
ALTER TABLE "MemberCharge" ADD CONSTRAINT "MemberCharge_beneficiaryContactId_fkey"
  FOREIGN KEY ("beneficiaryContactId") REFERENCES "Contact"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
