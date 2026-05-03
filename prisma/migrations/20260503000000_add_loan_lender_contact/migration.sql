-- HAND_FORMAL loans now reference the workspace Contact who lent the
-- money instead of (just) carrying a free-text lender name. The string
-- column stays as the displayed name for legacy rows and as a denormalised
-- fallback when the contact is renamed/archived later.

ALTER TABLE "Loan" ADD COLUMN "lenderContactId" TEXT;

ALTER TABLE "Loan"
  ADD CONSTRAINT "Loan_lenderContactId_fkey"
  FOREIGN KEY ("lenderContactId")
  REFERENCES "Contact"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "Loan_workspaceId_lenderContactId_idx"
  ON "Loan"("workspaceId", "lenderContactId");
