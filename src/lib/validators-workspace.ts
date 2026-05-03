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

/**
 * PATCH /api/workspaces/[id] body. All fields optional — present fields
 * update, omitted fields stay. `transactionEditWindowDays` controls how
 * long non-card transactions / attendance entries stay editable from
 * their date; 0 disables the window for this workspace.
 */
export const workspaceUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    transactionEditWindowDays: z
      .number()
      .int()
      .min(0)
      .max(365)
      .optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "Provide at least one field to update",
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
