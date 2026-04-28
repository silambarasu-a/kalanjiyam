-- Drop CREDIT_CARD_LOAN from LoanSource (added in error in the previous
-- migration) by recreating the enum without it. Safe because no rows have
-- been inserted with that value yet.
CREATE TYPE "LoanSource_new" AS ENUM ('BANK', 'HAND_FORMAL', 'CARD_EMI');
ALTER TABLE "Loan" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "Loan" ALTER COLUMN "source" TYPE "LoanSource_new" USING ("source"::text::"LoanSource_new");
ALTER TABLE "Loan" ALTER COLUMN "source" SET DEFAULT 'BANK';
DROP TYPE "LoanSource";
ALTER TYPE "LoanSource_new" RENAME TO "LoanSource";

-- Add CREDIT_CARD_LOAN as a new LoanKind so it can be picked from the
-- existing loan-kind dropdown.
ALTER TYPE "LoanKind" ADD VALUE 'CREDIT_CARD_LOAN';
