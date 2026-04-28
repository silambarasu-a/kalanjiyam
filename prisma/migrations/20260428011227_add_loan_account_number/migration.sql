-- Optional virtual loan-account number for CREDIT_CARD_LOAN kinds (e.g.
-- HDFC Insta Jumbo Loan AAN). Stored as free text alongside the parent
-- credit card link.
ALTER TABLE "Loan" ADD COLUMN "loanAccountNumber" TEXT;
