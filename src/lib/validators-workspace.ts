import { z } from "zod";
import { FEATURES } from "@/lib/permissions";

const featureEnum = z.enum(FEATURES);
const levelEnum = z.enum(["hidden", "own", "view", "full"]);
const permissionsRecord = z.record(featureEnum, levelEnum);

export const workspaceCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
});

export const workspaceRenameSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const inviteCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["ADMIN", "MEMBER"]),
  permissions: permissionsRecord.optional(),
});

export const memberUpdateSchema = z.object({
  role: z.enum(["ADMIN", "MEMBER"]).optional(),
  permissions: permissionsRecord.optional(),
});
