-- Bulk contact settlement: leftover handling + advance credit.
--
-- Three additive changes, no backfill needed anywhere:
--
-- 1. Contact.advanceHeld / advancePaid — running advance-credit counters.
--    Deliberately counters and not MemberCharge rows: a charge could be both
--    cash-repaid AND applied as credit for the same rupees, and it would
--    double-count the `settled` total every reader sums off settledAmount.
--    Both DEFAULT 0, which is exactly right for every existing contact.
--
-- 2. MemberChargeSettlement.fundedByAdvance — marks a settlement paid out of
--    advance credit rather than cash. DEFAULT false is correct for history:
--    every one of the existing settlement rows carries a transactionId, so
--    none of them was advance-funded.
--
-- 3. Transfer.settlementTxnId — ties the leftover half of a bulk settlement
--    back to the settlement transaction, so deleting one can clean up the
--    other instead of stranding it. NULL on every existing transfer, which is
--    correct: none of them came from a settlement. SET NULL rather than
--    CASCADE on purpose — the delete has to run through application code so
--    the leftover's MemberCharge gets reconciled instead of orphaned.
--
-- The CHECK constraints below close read-then-write races the same way
-- 20260520120000_advance_balance_check does for UtilityProvider. Added
-- directly (not NOT VALID) because the data was audited first and is clean:
-- zero rows with settledAmount > amount, zero negative balances.

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "advanceHeld" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "advancePaid" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "MemberChargeSettlement" ADD COLUMN     "fundedByAdvance" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Transfer" ADD COLUMN     "settlementTxnId" TEXT;

-- CreateIndex
CREATE INDEX "MemberChargeSettlement_transactionId_idx" ON "MemberChargeSettlement"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_settlementTxnId_key" ON "Transfer"("settlementTxnId");

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_settlementTxnId_fkey" FOREIGN KEY ("settlementTxnId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Stops two concurrent settlements from each clearing the same charge. Both
-- callers read the same `remaining` outside their transaction, both pass the
-- per-line cap, and the second UPDATE would otherwise land a second full
-- payment on an already-cleared charge. The settle route now writes with an
-- atomic { increment }, so the arithmetic itself is exact; this CHECK is what
-- fails the loser instead of letting the over-settle through. SQLSTATE 23514
-- is translated to a 409 with a retry message by src/lib/member-charge-guard.ts.
-- The 0.01 slack matches the tolerance the settle routes already use when
-- deciding a charge is fully settled.
ALTER TABLE "MemberCharge"
  ADD CONSTRAINT "MemberCharge_settled_le_amount_check"
  CHECK ("settledAmount" <= "amount" + 0.01);

-- Same race, other direction: two concurrent "apply advance credit" flows
-- each see the same balance available and each try to draw it down.
ALTER TABLE "Contact"
  ADD CONSTRAINT "Contact_advanceHeld_nonneg_check"
  CHECK ("advanceHeld" >= 0);

ALTER TABLE "Contact"
  ADD CONSTRAINT "Contact_advancePaid_nonneg_check"
  CHECK ("advancePaid" >= 0);
