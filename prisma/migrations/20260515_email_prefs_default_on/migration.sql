-- Default new WorkspaceMember rows to opted-in for email notifications.
-- Existing rows are NOT modified here — handled by the one-time
-- prisma/scripts/enable-email-prefs-default.ts backfill.
ALTER TABLE "WorkspaceMember" ALTER COLUMN "emailPrefs" SET DEFAULT '{"enabled":true}';
