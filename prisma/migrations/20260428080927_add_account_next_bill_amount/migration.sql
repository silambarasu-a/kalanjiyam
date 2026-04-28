-- Bill amount that pairs with Account.nextBillDue, captured at card
-- onboarding so users can record both the date and the amount of an
-- already-generated statement bill.
ALTER TABLE "Account" ADD COLUMN "nextBillAmount" DECIMAL(14,2);
