-- The free-form loan "name" added in 20260616010000 went unused; loans are
-- identified by lender + (now) loan account number instead. Drop it.
ALTER TABLE "Loan" DROP COLUMN "name";
