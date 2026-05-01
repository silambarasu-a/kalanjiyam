-- Allow finer-grained share quantities (US fractional shares can have 6+ decimals).
ALTER TABLE "Investment" ALTER COLUMN "quantity" TYPE DECIMAL(18, 6);

-- Capture the USD/INR rate at the time of purchase so cost basis is locked
-- in INR and does not drift with daily FX moves. Backfilled below from the
-- existing amount = qty * price * rate relationship.
ALTER TABLE "Investment" ADD COLUMN "purchaseExchangeRate" DECIMAL(10, 4);

-- Backfill: recover the rate that was used when the holding was originally
-- saved. For INR holdings this evaluates to ~1; for USD holdings it recovers
-- the historical rate snapshot. Rows without enough data stay NULL and the
-- app falls back to the live rate at display time.
UPDATE "Investment"
SET "purchaseExchangeRate" = ROUND("amount" / ("quantity" * "purchasePrice"), 4)
WHERE "kind" = 'STOCK'
  AND "quantity" IS NOT NULL AND "quantity" > 0
  AND "purchasePrice" IS NOT NULL AND "purchasePrice" > 0
  AND "amount" > 0;
