-- Multi-year insurance premium cadences. Appended to the existing
-- PremiumFrequency enum (values added after ONE_TIME, matching the value
-- order already present in the database).
ALTER TYPE "PremiumFrequency" ADD VALUE IF NOT EXISTS 'EVERY_2_YEARS';
ALTER TYPE "PremiumFrequency" ADD VALUE IF NOT EXISTS 'EVERY_3_YEARS';
ALTER TYPE "PremiumFrequency" ADD VALUE IF NOT EXISTS 'EVERY_5_YEARS';
