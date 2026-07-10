-- General document attachments owned directly by a Contact (ID proofs,
-- agreements, photos). Inserted before EVENT_DOCUMENT to match the enum
-- order declared in schema.prisma.
ALTER TYPE "AttachmentOwnerKind" ADD VALUE IF NOT EXISTS 'CONTACT_DOCUMENT' BEFORE 'EVENT_DOCUMENT';
