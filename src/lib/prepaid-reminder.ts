import {
  type Prisma,
  ReminderKind,
  ReminderStatus,
} from "@/generated/prisma/client";

/**
 * Re-point a prepaid provider's single validity reminder.
 *
 * Deletes any UPCOMING `UTILITY_RECHARGE_DUE` reminder for the provider
 * and — when a validity date is set — creates exactly one whose `dueDate`
 * equals the expiry itself. The daily notifications sweep then warns at
 * 5 / 3 / 1 / 0 days before it lapses. This delete-and-recreate mirrors
 * the vehicle-document expiry resync (`vehicles/[id]/documents/[docId]`)
 * and is the per-recharge "the date moved" hook.
 *
 * Runs against a transaction client so the caller keeps the reminder
 * change atomic with the provider/payment write.
 */
export async function resyncPrepaidReminder(
  tx: Prisma.TransactionClient,
  args: { workspaceId: string; providerId: string; validUntil: Date | null },
): Promise<void> {
  await tx.investmentReminder.deleteMany({
    where: {
      utilityProviderId: args.providerId,
      kind: ReminderKind.UTILITY_RECHARGE_DUE,
      status: ReminderStatus.UPCOMING,
    },
  });
  if (args.validUntil) {
    await tx.investmentReminder.create({
      data: {
        workspaceId: args.workspaceId,
        utilityProviderId: args.providerId,
        kind: ReminderKind.UTILITY_RECHARGE_DUE,
        dueDate: args.validUntil,
        status: ReminderStatus.UPCOMING,
      },
    });
  }
}
