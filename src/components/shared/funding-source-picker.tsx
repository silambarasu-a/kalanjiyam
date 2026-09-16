"use client";

import { useMemo } from "react";
import { NativeSelect, type NativeSelectGroup } from "@/components/ui/native-select";
import {
  buildFundingSourceGroups,
  type FundingSourceKind,
} from "@/lib/funding-sources";
import { useFundingSources } from "@/lib/use-funding-sources";

export type FundingSourcePickerProps = {
  /** `"account:<id>" | "card:<id>" | "contact:<id>" | ""` */
  value: string;
  onChange: (next: string) => void;
  /**
   * Which groups to offer. Defaults to accounts + both card kinds for
   * `direction="out"`, and to BANK / WALLET / CASH for `direction="in"`.
   */
  kinds?: readonly FundingSourceKind[];
  /** "out" = money leaves the source (default), "in" = money lands in it. */
  direction?: "in" | "out";
  /** Amount about to leave — rows that can't cover it are greyed out. */
  amount?: number;
  excludeAccountIds?: readonly string[];
  excludeCardIds?: readonly string[];
  /**
   * Extra groups that aren't funding sources — "Cash in hand (no
   * account)", "Already owned", "Advance credit". Rendered before
   * (`prepend`) or after (`append`) the funding groups.
   */
  prependGroups?: NativeSelectGroup[];
  appendGroups?: NativeSelectGroup[];
  /** Hint on contact rows when `kinds` includes CONTACT. Default "they paid". */
  contactHint?: string;
  /** Hold the fetches until true (e.g. `enabled={open}`). */
  enabled?: boolean;
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  loadingMessage?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
};

const IN_KINDS: readonly FundingSourceKind[] = ["BANK", "WALLET", "CASH"];
const OUT_KINDS: readonly FundingSourceKind[] = [
  "BANK",
  "WALLET",
  "CASH",
  "DEBIT",
  "CREDIT",
];

/**
 * The one "Pay from" / "Receive into" dropdown. Fetches accounts, cards
 * (and contacts when `kinds` includes CONTACT) itself, groups them in the
 * workspace's configured order and hands a prefixed value back — see
 * `src/lib/funding-sources.ts` for the value format and the helpers that
 * turn it into `{ accountId, cardId, contactId }` at submit time.
 */
export function FundingSourcePicker({
  value,
  onChange,
  kinds,
  direction = "out",
  amount = 0,
  excludeAccountIds,
  excludeCardIds,
  prependGroups,
  appendGroups,
  contactHint,
  enabled = true,
  placeholder,
  searchable = true,
  searchPlaceholder,
  loadingMessage,
  disabled,
  autoFocus,
  className,
}: FundingSourcePickerProps) {
  const effectiveKinds = kinds ?? (direction === "in" ? IN_KINDS : OUT_KINDS);
  const withContacts = effectiveKinds.includes("CONTACT");
  const withCards = effectiveKinds.includes("DEBIT") || effectiveKinds.includes("CREDIT");
  const { accounts, cards, contacts, order, loading } = useFundingSources({
    enabled,
    withCards,
    withContacts,
  });

  const options = useMemo<NativeSelectGroup[]>(() => {
    const groups = buildFundingSourceGroups({
      accounts,
      cards,
      contacts,
      order,
      kinds: effectiveKinds,
      amount,
      direction,
      excludeAccountIds,
      excludeCardIds,
      contactHint,
    });
    return [...(prependGroups ?? []), ...groups, ...(appendGroups ?? [])];
  }, [
    accounts,
    cards,
    contacts,
    order,
    effectiveKinds,
    amount,
    direction,
    excludeAccountIds,
    excludeCardIds,
    contactHint,
    prependGroups,
    appendGroups,
  ]);

  const what = withContacts
    ? "accounts, cards, contacts"
    : withCards
      ? "accounts & cards"
      : "accounts";

  return (
    <NativeSelect
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder ?? (withCards ? "Pick an account or card" : "Pick an account")}
      searchable={searchable}
      searchPlaceholder={searchPlaceholder ?? `Search ${what}…`}
      loading={loading}
      loadingMessage={loadingMessage ?? `Loading ${what}…`}
      disabled={disabled}
      autoFocus={autoFocus}
      className={className}
    />
  );
}
