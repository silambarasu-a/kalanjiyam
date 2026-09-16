"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-fetcher";
import {
  DEFAULT_FUNDING_SOURCE_ORDER,
  normalizeFundingSourceOrder,
  type FundingAccount,
  type FundingCard,
  type FundingContact,
  type FundingSourceKind,
} from "@/lib/funding-sources";

export const FUNDING_SOURCE_ORDER_KEY = "/api/settings/funding-sources";

/**
 * Everything a funding-source picker needs, from one hook. SWR dedupes the
 * keys, so a dialog that already fetches `/api/accounts` for its own
 * reasons doesn't pay for a second request.
 *
 * Pass `enabled: false` (e.g. `enabled={open}`) to hold the fetches until
 * the dialog is actually shown. `withContacts` adds `/api/contacts` for
 * pickers that offer "Paid by contact".
 */
export function useFundingSources(opts: {
  enabled?: boolean;
  /** Also fetch `/api/cards`. Off for account-only pickers. */
  withCards?: boolean;
  withContacts?: boolean;
} = {}) {
  const { enabled = true, withCards = true, withContacts = false } = opts;

  const { data: accountsData, isLoading: accountsLoading } = useSWR<{
    accounts: FundingAccount[];
  }>(enabled ? "/api/accounts" : null, fetcher);
  const { data: cardsData, isLoading: cardsLoading } = useSWR<{
    cards: FundingCard[];
  }>(enabled && withCards ? "/api/cards" : null, fetcher);
  const { data: contactsData, isLoading: contactsLoading } = useSWR<{
    members: FundingContact[];
  }>(enabled && withContacts ? "/api/contacts" : null, fetcher);
  const { data: orderData } = useSWR<{ order: FundingSourceKind[] }>(
    enabled ? FUNDING_SOURCE_ORDER_KEY : null,
    fetcher,
  );

  const accounts = useMemo(() => accountsData?.accounts ?? [], [accountsData]);
  const cards = useMemo(() => cardsData?.cards ?? [], [cardsData]);
  const contacts = useMemo(() => contactsData?.members ?? [], [contactsData]);
  const order = useMemo(
    () =>
      orderData ? normalizeFundingSourceOrder(orderData.order) : DEFAULT_FUNDING_SOURCE_ORDER,
    [orderData],
  );

  return {
    accounts,
    cards,
    contacts,
    order,
    loading:
      accountsLoading ||
      (withCards && cardsLoading) ||
      (withContacts && contactsLoading),
  };
}
