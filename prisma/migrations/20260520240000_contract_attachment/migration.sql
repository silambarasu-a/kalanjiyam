-- Lets users attach signed contract PDFs / partner agreements to a
-- LivestockContract record. Same pattern as LIVESTOCK_BATCH_DOCUMENT.
ALTER TYPE "AttachmentOwnerKind" ADD VALUE 'LIVESTOCK_CONTRACT_DOCUMENT';
