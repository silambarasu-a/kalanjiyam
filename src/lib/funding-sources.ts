/**
 * Funding sources — the one place that knows how to turn accounts, cards
 * and contacts into the grouped "Pay from" / "Receive into" picker.
 *
 * Every picker in the app (transactions, bills, subscriptions, loans,
 * contacts, livestock, wages, gold, …) renders through
 * `buildFundingSourceGroups` so they all share the same labels, balance
 * hints, owner colour dots, affordability greying and — importantly — the
 * same group order, which the workspace Owner/Admin can rearrange in
 * workspace settings (`Workspace.fundingSourceOrder`).
 *
 * The picker value is a single prefixed string so one state variable can
 * hold any kind of source:
 *   "account:<id>" | "card:<id>" | "contact:<id>" | ""
 * Use `parseFundingSource` / `fundingSourceIds` at submit time to turn it
 * back into the `{ accountId, cardId, contactId }` shape the APIs take.
 *
 * Pure module — no React, no fetch — so the server (validators, workspace
 * PATCH) and the client share the same key list.
 */

import type { NativeSelectGroup, NativeSelectOption } from "@/components/ui/native-select";
import {
  memberColorsFor,
  rowOwner,
  shortMemberName,
  type MemberColor,
  type OwnedRow,
} from "@/lib/member-colors";
import { formatAccountLabel, formatINR } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Group kinds + workspace order                                        */
/* ------------------------------------------------------------------ */

export const FUNDING_SOURCE_KINDS = [
  "BANK",
  "WALLET",
  "CASH",
  "DEBIT",
  "CREDIT",
  "CONTACT",
] as const;
export type FundingSourceKind = (typeof FUNDING_SOURCE_KINDS)[number];

export const FUNDING_SOURCE_KIND_META: Record<
  FundingSourceKind,
  { label: string; description: string }
> = {
  BANK: { label: "Bank accounts", description: "Savings and current accounts" },
  WALLET: { label: "Wallets", description: "UPI wallets and prepaid balances" },
  CASH: { label: "Cash", description: "Cash in hand" },
  DEBIT: { label: "Debit cards", description: "Draw on their linked bank account" },
  CREDIT: { label: "Credit cards", description: "Spend against the card's limit" },
  CONTACT: {
    label: "Paid by contact",
    description: "Someone else paid — shown on expenses only",
  },
};

/** The order pickers use when a workspace has never rearranged its groups. */
export const DEFAULT_FUNDING_SOURCE_ORDER: FundingSourceKind[] = [
  ...FUNDING_SOURCE_KINDS,
];

export function isFundingSourceKind(v: unknown): v is FundingSourceKind {
  return (
    typeof v === "string" &&
    (FUNDING_SOURCE_KINDS as readonly string[]).includes(v)
  );
}

/**
 * Turn whatever is stored on the workspace into a full, de-duplicated
 * order: known keys keep their relative position, unknown keys are
 * dropped, and any kind that's missing is appended in default order. The
 * result always contains every kind exactly once, so a new kind added to
 * the app never disappears from workspaces that saved an order earlier.
 */
export function normalizeFundingSourceOrder(
  raw: unknown,
): FundingSourceKind[] {
  const out: FundingSourceKind[] = [];
  if (Array.isArray(raw)) {
    for (const k of raw) {
      if (isFundingSourceKind(k) && !out.includes(k)) out.push(k);
    }
  }
  for (const k of DEFAULT_FUNDING_SOURCE_ORDER) {
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

/** True when the stored order is the default (or empty). */
export function isDefaultFundingSourceOrder(order: readonly string[]): boolean {
  const norm = normalizeFundingSourceOrder(order);
  return norm.every((k, i) => k === DEFAULT_FUNDING_SOURCE_ORDER[i]);
}

/* ------------------------------------------------------------------ */
/* Picker value encoding                                                */
/* ------------------------------------------------------------------ */

export type FundingSourceRefKind = "account" | "card" | "contact";
export type FundingSourceRef = { kind: FundingSourceRefKind; id: string };

export function fundingSourceValue(
  kind: FundingSourceRefKind,
  id: string | null | undefined,
): string {
  return id ? `${kind}:${id}` : "";
}

/** `"account:<id>"` → `{ kind: "account", id }`; anything else → null. */
export function parseFundingSource(
  value: string | null | undefined,
): FundingSourceRef | null {
  if (!value) return null;
  const i = value.indexOf(":");
  if (i <= 0) return null;
  const kind = value.slice(0, i);
  const id = value.slice(i + 1);
  if (!id) return null;
  if (kind !== "account" && kind !== "card" && kind !== "contact") return null;
  return { kind, id };
}

/**
 * The `{ accountId, cardId, contactId }` triple most write endpoints take.
 * Exactly one is set for a valid value; all null for "".
 */
export function fundingSourceIds(value: string | null | undefined): {
  accountId: string | null;
  cardId: string | null;
  contactId: string | null;
} {
  const ref = parseFundingSource(value);
  return {
    accountId: ref?.kind === "account" ? ref.id : null,
    cardId: ref?.kind === "card" ? ref.id : null,
    contactId: ref?.kind === "contact" ? ref.id : null,
  };
}

/** Rebuild a picker value from a stored `{ accountId, cardId }` pair. */
export function fundingSourceFromIds(ids: {
  accountId?: string | null;
  cardId?: string | null;
  contactId?: string | null;
}): string {
  if (ids.cardId) return fundingSourceValue("card", ids.cardId);
  if (ids.accountId) return fundingSourceValue("account", ids.accountId);
  if (ids.contactId) return fundingSourceValue("contact", ids.contactId);
  return "";
}

/* ------------------------------------------------------------------ */
/* Row shapes (subset of GET /api/accounts, /api/cards, /api/contacts)  */
/* ------------------------------------------------------------------ */

export type FundingAccount = OwnedRow & {
  id: string;
  name: string;
  kind: "BANK" | "CASH" | "CARD" | "WALLET";
  balance: number;
  availableLimit?: number | null;
  active?: boolean;
};

export type FundingCard = OwnedRow & {
  id: string;
  name: string;
  kind: "DEBIT" | "CREDIT";
  /** Companion ledger account. A card without one can't take a posting. */
  accountId: string | null;
  availableLimit: number | null;
  last4: string | null;
  active?: boolean;
};

export type FundingContact = { id: string; name: string };

/* ------------------------------------------------------------------ */
/* Group builder                                                        */
/* ------------------------------------------------------------------ */

export type BuildFundingSourceGroupsOptions = {
  accounts: readonly FundingAccount[];
  cards?: readonly FundingCard[];
  contacts?: readonly FundingContact[];
  /** Workspace group order (already normalised or raw — both accepted). */
  order?: readonly string[];
  /**
   * Which groups to render. Defaults to every account kind plus both card
   * kinds; pass `["BANK", "WALLET", "CASH"]` for "Receive into" pickers,
   * add `"CONTACT"` where a contact may pay on the user's behalf.
   */
  kinds?: readonly FundingSourceKind[];
  /**
   * Amount about to leave the source. Rows that can't cover it are greyed
   * out. Ignored (nothing greyed) when `direction` is "in".
   */
  amount?: number;
  /** "out" = money leaves the source (default); "in" = money lands in it. */
  direction?: "in" | "out";
  excludeAccountIds?: readonly string[];
  excludeCardIds?: readonly string[];
  /**
   * Owner colours from `memberColorsFor(allAccounts)` — pass this when the
   * `accounts` list handed in is a filtered subset so members keep the
   * same colour across pickers. Derived from `accounts` when omitted.
   */
  ownerColors?: Map<string, MemberColor>;
  /** Hint shown on contact rows. Defaults to "they paid". */
  contactHint?: string;
};

const DEFAULT_KINDS: readonly FundingSourceKind[] = [
  "BANK",
  "WALLET",
  "CASH",
  "DEBIT",
  "CREDIT",
];

export function buildFundingSourceGroups(
  opts: BuildFundingSourceGroupsOptions,
): NativeSelectGroup[] {
  const {
    accounts,
    cards = [],
    contacts = [],
    kinds = DEFAULT_KINDS,
    amount = 0,
    direction = "out",
    excludeAccountIds = [],
    excludeCardIds = [],
    contactHint = "they paid",
  } = opts;
  const order = normalizeFundingSourceOrder(opts.order);
  const want = new Set(kinds);
  const checkFunds = direction === "out" && amount > 0;

  // Colour-code by owning member so two members' identically-named
  // accounts are tellable apart. Derived from the full account list (which
  // includes the companion CARD rows) so cards and accounts agree.
  const ownerColors = opts.ownerColors ?? memberColorsFor([...accounts, ...cards]);
  const decorate = (row: OwnedRow): Pick<NativeSelectOption, "dotClassName" | "meta"> => {
    const owner = rowOwner(row);
    const color = owner ? ownerColors?.get(owner.id) : undefined;
    if (!owner || !color) return {};
    return { dotClassName: color.dot, meta: shortMemberName(owner.name) || undefined };
  };

  const buckets: Record<FundingSourceKind, NativeSelectOption[]> = {
    BANK: [],
    WALLET: [],
    CASH: [],
    DEBIT: [],
    CREDIT: [],
    CONTACT: [],
  };

  const skipAccount = new Set(excludeAccountIds);
  for (const a of accounts) {
    // Companion card-accounts are surfaced via the card rows instead.
    if (a.kind === "CARD") continue;
    if (!want.has(a.kind) || skipAccount.has(a.id)) continue;
    const insufficient = checkFunds && amount > a.balance;
    buckets[a.kind].push({
      value: fundingSourceValue("account", a.id),
      label: formatAccountLabel(a.name, a.kind),
      hint: formatINR(a.balance),
      disabled: insufficient,
      ...decorate(a),
    });
  }

  const skipCard = new Set(excludeCardIds);
  for (const c of cards) {
    if (!want.has(c.kind) || skipCard.has(c.id)) continue;
    // A card posts through its companion account; without one the server
    // has nowhere to book the movement, so don't offer it.
    if (!c.accountId) continue;
    const baseLabel = formatAccountLabel(c.name, "CARD");
    const label = c.last4 ? `${baseLabel} ••${c.last4}` : baseLabel;
    const avail = c.availableLimit;
    const insufficient = checkFunds && avail != null && amount > avail;
    buckets[c.kind].push({
      value: fundingSourceValue("card", c.id),
      label,
      hint:
        c.kind === "CREDIT"
          ? `${avail != null ? formatINR(avail) : "—"} avail`
          : avail != null
            ? formatINR(avail)
            : "—",
      disabled: insufficient,
      ...decorate(c),
    });
  }

  if (want.has("CONTACT")) {
    for (const c of contacts) {
      buckets.CONTACT.push({
        value: fundingSourceValue("contact", c.id),
        label: c.name,
        hint: contactHint,
        disabled: false,
      });
    }
  }

  return order
    .filter((k) => buckets[k].length > 0)
    .map((k) => ({
      label: FUNDING_SOURCE_KIND_META[k].label,
      options: buckets[k],
    }));
}
