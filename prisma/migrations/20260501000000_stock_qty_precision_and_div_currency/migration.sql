-- Allow finer-grained share quantities (US fractional shares can have 6+ decimals).
ALTER TABLE "Investment" ALTER COLUMN "quantity" TYPE DECIMAL(18, 6);
