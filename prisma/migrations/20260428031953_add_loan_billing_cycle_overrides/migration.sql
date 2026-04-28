-- Per-loan billing-cycle overrides for CREDIT_CARD_LOAN kinds. When set
-- they take precedence over the linked card's account.statementDate /
-- gracePeriod (e.g. HDFC Insta Jumbo Loan AAN may bill on a different
-- cycle than the parent card; the linked card may also have no statement
-- info configured at all).
ALTER TABLE "Loan" ADD COLUMN "loanStatementDate" INTEGER;
ALTER TABLE "Loan" ADD COLUMN "loanGracePeriod" INTEGER;
