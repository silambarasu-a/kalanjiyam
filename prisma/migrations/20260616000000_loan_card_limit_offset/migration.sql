-- CARD_EMI reconciliation bookkeeping. When an existing credit-card EMI is
-- added, its remaining principal is already inside the linked card's
-- outstanding statement balance (and so already reduces the card's available
-- limit). We move that principal OUT of the card's outstanding into the EMI
-- (loan) bucket to avoid double-counting the limit; this column records how
-- much was moved so the move can be reversed (added back to the card's
-- outstanding) if the EMI is later deleted.
ALTER TABLE "Loan" ADD COLUMN "cardLimitOffset" DECIMAL(14,2) NOT NULL DEFAULT 0;
