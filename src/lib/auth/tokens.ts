import { randomBytes, createHash } from "crypto";
import { prisma } from "@/lib/prisma";

const VERIFICATION_TTL_HOURS = Number(process.env.EMAIL_VERIFICATION_TTL_HOURS ?? 24);
const RESET_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? 60);

export function generateRawToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

export async function createEmailVerificationToken(userId: string) {
  await prisma.emailVerificationToken.deleteMany({ where: { userId } });
  const raw = generateRawToken();
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_HOURS * 60 * 60 * 1000);
  await prisma.emailVerificationToken.create({ data: { userId, tokenHash, expiresAt } });
  return raw;
}

export async function consumeEmailVerificationToken(raw: string) {
  const tokenHash = hashToken(raw);
  const token = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
  if (!token) return { ok: false as const, reason: "invalid" as const };
  if (token.expiresAt.getTime() < Date.now()) {
    await prisma.emailVerificationToken.delete({ where: { tokenHash } });
    return { ok: false as const, reason: "expired" as const };
  }
  await prisma.$transaction([
    prisma.user.update({
      where: { id: token.userId },
      data: { emailVerified: new Date() },
    }),
    prisma.emailVerificationToken.deleteMany({ where: { userId: token.userId } }),
  ]);
  return { ok: true as const, userId: token.userId };
}

export async function createPasswordResetToken(userId: string) {
  await prisma.passwordResetToken.deleteMany({ where: { userId } });
  const raw = generateRawToken();
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000);
  await prisma.passwordResetToken.create({ data: { userId, tokenHash, expiresAt } });
  return raw;
}

export async function consumePasswordResetToken(raw: string) {
  const tokenHash = hashToken(raw);
  const token = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!token) return { ok: false as const, reason: "invalid" as const };
  if (token.usedAt) return { ok: false as const, reason: "used" as const };
  if (token.expiresAt.getTime() < Date.now())
    return { ok: false as const, reason: "expired" as const };
  return { ok: true as const, userId: token.userId, tokenId: token.id };
}

export async function markPasswordResetTokenUsed(tokenId: string, userId: string) {
  await prisma.$transaction([
    prisma.passwordResetToken.update({
      where: { id: tokenId },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.deleteMany({
      where: { userId, id: { not: tokenId } },
    }),
  ]);
}
