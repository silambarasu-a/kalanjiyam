-- Vehicle registration numbers were globally unique, which blocked adding a
-- vehicle whose plate already existed in a *different* workspace (the create
-- failed with a generic 500). Registrations should only be unique WITHIN a
-- workspace. Swap the global unique index for a workspace-scoped composite.
--
-- Safe backfill: the old global unique guaranteed no two rows shared a
-- registrationNo at all, so every existing row already satisfies the weaker
-- (workspaceId, registrationNo) uniqueness. NULL registrationNo rows remain
-- unconstrained (Postgres treats NULLs as distinct in unique indexes).
DROP INDEX "Vehicle_registrationNo_key";

CREATE UNIQUE INDEX "Vehicle_workspaceId_registrationNo_key" ON "Vehicle"("workspaceId", "registrationNo");
