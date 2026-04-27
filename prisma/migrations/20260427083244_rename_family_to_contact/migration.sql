-- Rename FamilyMember model to Contact across the schema. All renames use
-- ALTER ... RENAME (preserves data and FK targets); no rebuilds. Also
-- migrates each WorkspaceMember.permissions JSONB row from the "family" key
-- to the new "contacts" key so existing role configs survive.

-- ── Rename the table and its constraints/indexes ───────────────────────
ALTER TABLE "FamilyMember" RENAME TO "Contact";
ALTER TABLE "Contact" RENAME CONSTRAINT "FamilyMember_pkey" TO "Contact_pkey";
ALTER TABLE "Contact" RENAME CONSTRAINT "FamilyMember_workspaceId_fkey" TO "Contact_workspaceId_fkey";
ALTER TABLE "Contact" RENAME CONSTRAINT "FamilyMember_userId_fkey" TO "Contact_userId_fkey";
ALTER INDEX "FamilyMember_userId_key" RENAME TO "Contact_userId_key";
ALTER INDEX "FamilyMember_workspaceId_active_idx" RENAME TO "Contact_workspaceId_active_idx";

-- ── Account.ownerMemberId → ownerContactId ─────────────────────────────
ALTER TABLE "Account" RENAME COLUMN "ownerMemberId" TO "ownerContactId";
ALTER TABLE "Account" RENAME CONSTRAINT "Account_ownerMemberId_fkey" TO "Account_ownerContactId_fkey";
ALTER INDEX "Account_workspaceId_ownerMemberId_idx" RENAME TO "Account_workspaceId_ownerContactId_idx";

-- ── Card.ownerMemberId → ownerContactId ────────────────────────────────
ALTER TABLE "Card" RENAME COLUMN "ownerMemberId" TO "ownerContactId";
ALTER TABLE "Card" RENAME CONSTRAINT "Card_ownerMemberId_fkey" TO "Card_ownerContactId_fkey";

-- ── Transaction.beneficiaryMemberId → beneficiaryContactId ─────────────
ALTER TABLE "Transaction" RENAME COLUMN "beneficiaryMemberId" TO "beneficiaryContactId";
ALTER TABLE "Transaction" RENAME CONSTRAINT "Transaction_beneficiaryMemberId_fkey" TO "Transaction_beneficiaryContactId_fkey";
ALTER INDEX "Transaction_beneficiaryMemberId_idx" RENAME TO "Transaction_beneficiaryContactId_idx";

-- ── MemberCharge.beneficiaryMemberId → beneficiaryContactId ────────────
-- (MemberCharge model name itself stays — it represents a charge, not a person.)
ALTER TABLE "MemberCharge" RENAME COLUMN "beneficiaryMemberId" TO "beneficiaryContactId";
ALTER TABLE "MemberCharge" RENAME CONSTRAINT "MemberCharge_beneficiaryMemberId_fkey" TO "MemberCharge_beneficiaryContactId_fkey";
ALTER INDEX "MemberCharge_workspaceId_beneficiaryMemberId_status_idx" RENAME TO "MemberCharge_workspaceId_beneficiaryContactId_status_idx";

-- ── Transfer.fromMemberId → fromContactId ──────────────────────────────
ALTER TABLE "Transfer" RENAME COLUMN "fromMemberId" TO "fromContactId";
ALTER TABLE "Transfer" RENAME CONSTRAINT "Transfer_fromMemberId_fkey" TO "Transfer_fromContactId_fkey";
ALTER INDEX "Transfer_fromMemberId_idx" RENAME TO "Transfer_fromContactId_idx";

-- ── Transfer.toMemberId → toContactId ──────────────────────────────────
ALTER TABLE "Transfer" RENAME COLUMN "toMemberId" TO "toContactId";
ALTER TABLE "Transfer" RENAME CONSTRAINT "Transfer_toMemberId_fkey" TO "Transfer_toContactId_fkey";
ALTER INDEX "Transfer_toMemberId_idx" RENAME TO "Transfer_toContactId_idx";

-- ── Lease.lessorMemberId / lesseeMemberId → *ContactId ─────────────────
ALTER TABLE "Lease" RENAME COLUMN "lessorMemberId" TO "lessorContactId";
ALTER TABLE "Lease" RENAME CONSTRAINT "Lease_lessorMemberId_fkey" TO "Lease_lessorContactId_fkey";
ALTER TABLE "Lease" RENAME COLUMN "lesseeMemberId" TO "lesseeContactId";
ALTER TABLE "Lease" RENAME CONSTRAINT "Lease_lesseeMemberId_fkey" TO "Lease_lesseeContactId_fkey";

-- ── Permission key migration in WorkspaceMember.permissions JSONB ──────
-- Move the "family" key to "contacts" for every workspace member that has
-- it. Rows without the key are untouched.
UPDATE "WorkspaceMember"
SET "permissions" = ("permissions" - 'family') || jsonb_build_object('contacts', "permissions"->'family')
WHERE "permissions" ? 'family';
