-- For CREDIT companion accounts: pre-existing bill due date captured at
-- onboarding. Lets users record an existing upcoming bill on a card they
-- already had before adding it to the app.
ALTER TABLE "Account" ADD COLUMN "nextBillDue" TIMESTAMP(3);
