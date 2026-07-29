import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email/send";
import { getAppUrl } from "@/lib/email/mailer";
import { paymentConfirmationTemplate } from "@/lib/email/templates/payment-confirmation";
import { paymentFailedTemplate } from "@/lib/email/templates/payment-failed";
import { signUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import {
  hasPermission,
  mergeWithDefaults,
  type Feature,
} from "@/lib/permissions";

/**
 * Fan-out a payment confirmation email to every workspace member who:
 *   1. Has accepted the workspace invite (acceptedAt != null)
 *   2. Has email notifications enabled (emailPrefs.enabled != false)
 *   3. Has `view` permission on the relevant feature
 *
 * Best-effort: silently skips delivery when RESEND_API_KEY isn't set or
 * any individual recipient fails. The transaction creation that
 * triggers this is already committed — email failures must not roll it
 * back.
 */
type PaymentKind = "SUBSCRIPTION" | "UTILITY_BILL" | "SETTLEMENT" | "ADVANCE";

const KIND_FEATURE: Record<PaymentKind, Feature> = {
  SUBSCRIPTION: "subscriptions",
  UTILITY_BILL: "bills",
  SETTLEMENT: "members",
  ADVANCE: "bills",
};

const KIND_LABEL: Record<PaymentKind, string> = {
  SUBSCRIPTION: "Subscription paid",
  UTILITY_BILL: "Bill paid",
  SETTLEMENT: "Settlement",
  ADVANCE: "Advance recorded",
};

export type PaymentConfirmationInput = {
  workspaceId: string;
  /** When set, restrict delivery to these userIds only — used by autopay
   *  to email just the subscription/provider owner instead of the whole
   *  workspace. Empty/omitted = broadcast to every permitted member. */
  recipientUserIds?: string[];
  kind: PaymentKind;
  /** True when the autopay cron fired this; false for user-triggered. */
  autopayed: boolean;
  /** Headline (subscription name, "TNEB bill", etc.). */
  label: string;
  /** Total bill / subscription / settlement amount. */
  amount: number;
  /** Friendly source name ("HDFC", "ICICI Millennia", "advance balance"). */
  sourceLabel: string;
  /** Subscription cycle ("monthly") — adds "next billing on …" line. */
  cycleLabel?: string;
  nextDate?: Date | null;
  /** For utility bills: advance vs cash split. */
  cashAmount?: number;
  advanceApplied?: number;
  remainingAdvance?: number;
  /** Deep link the email's CTA button points at. */
  link: string;
};

export async function sendPaymentConfirmationEmail(
  input: PaymentConfirmationInput,
): Promise<void> {
  const appUrl = getAppUrl();

  const recipientFilter = input.recipientUserIds?.length
    ? { in: input.recipientUserIds }
    : undefined;
  const members = await prisma.workspaceMember.findMany({
    where: {
      workspaceId: input.workspaceId,
      acceptedAt: { not: null },
      ...(recipientFilter ? { userId: recipientFilter } : {}),
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      workspace: { select: { farmEnabled: true } },
    },
  });

  for (const m of members) {
    const prefs = (m.emailPrefs ?? {}) as {
      enabled?: boolean;
    };
    if (prefs.enabled === false) continue;

    // Permission gate by the relevant feature. Skip the gate when an
    // explicit recipient list was passed (caller already verified the
    // user is the relevant owner) — otherwise SETTLEMENT emails would
    // never reach regular MEMBERs since `members` defaults to hidden.
    if (!input.recipientUserIds?.length) {
      const fakeSession = {
        user: {
          id: m.userId,
          role: m.role,
          permissions: mergeWithDefaults(m.permissions),
          // No farm kinds in KIND_FEATURE today, so this changes nothing
          // yet — set it so adding one later can't silently become a hole,
          // since `getPermission` reads an absent flag as farm-on.
          farmEnabled: m.workspace.farmEnabled,
        },
      } as Parameters<typeof hasPermission>[0];
      if (!hasPermission(fakeSession, KIND_FEATURE[input.kind], "view")) {
        continue;
      }
    }

    const extraLineParts: string[] = [];
    if (input.advanceApplied != null && input.advanceApplied > 0) {
      extraLineParts.push(
        `₹${Number(input.advanceApplied).toLocaleString("en-IN")} from advance`,
      );
    }
    if (input.cashAmount != null && input.cashAmount > 0) {
      extraLineParts.push(
        `₹${Number(input.cashAmount).toLocaleString("en-IN")} from ${input.sourceLabel}`,
      );
    }
    if (
      input.remainingAdvance != null &&
      input.kind === "UTILITY_BILL"
    ) {
      extraLineParts.push(
        `Advance remaining: ₹${Number(input.remainingAdvance).toLocaleString(
          "en-IN",
        )}`,
      );
    }
    const extraLine = extraLineParts.length ? extraLineParts.join(" · ") : undefined;

    const nextLine =
      input.nextDate && input.cycleLabel
        ? `Next ${input.cycleLabel} cycle on ${input.nextDate.toLocaleDateString(
            "en-IN",
            { day: "2-digit", month: "short", year: "numeric" },
          )}`
        : undefined;

    let unsubscribeUrl: string | undefined;
    try {
      const token = signUnsubscribeToken(m.id);
      unsubscribeUrl = `${appUrl}/unsubscribe?t=${encodeURIComponent(token)}`;
    } catch {
      unsubscribeUrl = undefined;
    }

    const tpl = paymentConfirmationTemplate({
      label: input.label,
      amount: input.amount,
      autopayed: input.autopayed,
      kindLabel: KIND_LABEL[input.kind],
      sourceLine: input.autopayed
        ? `Auto-paid from ${input.sourceLabel}`
        : `Paid from ${input.sourceLabel}`,
      extraLine,
      nextLine,
      link: input.link.startsWith("http") ? input.link : `${appUrl}${input.link}`,
      appUrl,
      unsubscribeUrl,
    });

    try {
      await sendEmail({
        to: m.user.email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
    } catch (e) {
      console.warn(
        `[payment-confirmation] failed to email ${m.user.email}`,
        e,
      );
    }
  }
}

export type PaymentFailedInput = {
  workspaceId: string;
  /** Who to notify — the item's owner (or workspace owner fallback). */
  recipientUserIds: string[];
  kind: PaymentKind;
  /** Headline ("TNEB — Jun 2026 bill", subscription name). */
  label: string;
  /** Amount that failed to pay. */
  amount: number;
  /** Human reason the auto-pay couldn't be recorded. */
  reason: string;
  /** Deep link so the user can pay it by hand. */
  link: string;
};

/**
 * Notify the owner that an auto-pay could NOT be recorded. Mirrors
 * `sendPaymentConfirmationEmail`'s recipient resolution (accepted members,
 * `enabled` opt-out honored) but always targets an explicit recipient list
 * — a failed payment must reach whoever owns the source, so no feature
 * gate. Best-effort; never throws into the caller's cron loop.
 */
export async function sendPaymentFailedEmail(
  input: PaymentFailedInput,
): Promise<void> {
  const appUrl = getAppUrl();
  if (!input.recipientUserIds.length) return;

  const members = await prisma.workspaceMember.findMany({
    where: {
      workspaceId: input.workspaceId,
      acceptedAt: { not: null },
      userId: { in: input.recipientUserIds },
    },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  for (const m of members) {
    const prefs = (m.emailPrefs ?? {}) as { enabled?: boolean };
    if (prefs.enabled === false) continue;

    let unsubscribeUrl: string | undefined;
    try {
      const token = signUnsubscribeToken(m.id);
      unsubscribeUrl = `${appUrl}/unsubscribe?t=${encodeURIComponent(token)}`;
    } catch {
      unsubscribeUrl = undefined;
    }

    const tpl = paymentFailedTemplate({
      label: input.label,
      amount: input.amount,
      kindLabel: KIND_LABEL[input.kind].replace(/ paid$/i, "").trim() || "Payment",
      reason: input.reason,
      link: input.link.startsWith("http") ? input.link : `${appUrl}${input.link}`,
      appUrl,
      unsubscribeUrl,
    });

    try {
      await sendEmail({
        to: m.user.email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
    } catch (e) {
      console.warn(`[payment-failed] failed to email ${m.user.email}`, e);
    }
  }
}
