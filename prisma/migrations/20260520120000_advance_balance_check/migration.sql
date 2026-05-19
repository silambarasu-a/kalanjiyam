-- Prevents two concurrent bill-pay flows from each deducting from the
-- same UtilityProvider advance balance and leaving it negative. Without
-- this guard the read-then-decrement window is small but real: both
-- callers see e.g. ₹800 available and each try to apply ₹800, yielding
-- a -₹800 balance. The CHECK constraint fails the losing transaction;
-- callers translate the SQLSTATE 23514 into a friendly 409 and the
-- user retries against the now-correct balance.
ALTER TABLE "UtilityProvider"
  ADD CONSTRAINT "UtilityProvider_advanceBalance_nonneg_check"
  CHECK ("advanceBalance" >= 0);
