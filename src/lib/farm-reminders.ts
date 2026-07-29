import type { NotificationKind, ReminderKind } from "@/generated/prisma/client";

/**
 * The reminder / notification kinds that only exist because of the farm.
 *
 * These need listing explicitly because the routes that read them are gated
 * on the "reminders" feature, which is not a farm feature — so the permission
 * choke-point in `getPermission` never masks them. Rows written while the farm
 * was on stay in the table (the flag masks, it never deletes), which is why the
 * READ side has to filter and not just the producer.
 *
 * LEASE_PAYMENT is farm because a Lease is always against a crop batch or a
 * livestock batch (`LeaseAssetType`).
 */
export const FARM_REMINDER_KINDS: ReminderKind[] = [
  "LEASE_PAYMENT",
  "VACCINATION_DUE",
  "LIVESTOCK_CYCLE_ENDING",
];

/** The `Notification` counterparts of the above. There is no lease notification kind. */
export const FARM_NOTIFICATION_KINDS: NotificationKind[] = [
  "VACCINATION_DUE",
  "LIVESTOCK_CYCLE_ENDING",
];
