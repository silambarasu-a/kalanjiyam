-- Loan gets an optional free-form name/label, and an optional link to the
-- workspace Contact (family member) whose name/account the loan is under
-- (e.g. a loan taken in the wife's or father's name). The member link is
-- separate from lenderContactId (who a hand loan was borrowed FROM).
ALTER TABLE "Loan" ADD COLUMN "name" TEXT;
ALTER TABLE "Loan" ADD COLUMN "memberContactId" TEXT;

ALTER TABLE "Loan"
  ADD CONSTRAINT "Loan_memberContactId_fkey"
  FOREIGN KEY ("memberContactId") REFERENCES "Contact"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
