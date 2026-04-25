import { z } from "zod";

export const signupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  workspaceName: z.string().trim().max(80).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email"),
  password: z.string().min(1, "Password is required"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(16, "Invalid token"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export const resendVerificationSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email"),
});

export const reverifySchema = z.object({
  password: z.string().min(1, "Password is required"),
});

export const workspaceCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
});

export const workspaceRenameSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
