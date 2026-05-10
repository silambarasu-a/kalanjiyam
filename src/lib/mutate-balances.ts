import { mutate } from "swr";

/**
 * Invalidate every SWR key whose URL touches account / card / transaction / ledger
 * data. Call after any mutation that could move money around.
 */
export function mutateBalances() {
  return mutate(
    (key) => {
      if (typeof key !== "string") return false;
      return (
        key.startsWith("/api/transactions") ||
        key.startsWith("/api/transfers") ||
        key.startsWith("/api/accounts") ||
        key.startsWith("/api/cards") ||
        key.startsWith("/api/contacts") ||
        key.startsWith("/api/member-charges") ||
        key.startsWith("/api/dashboard") ||
        key.startsWith("/api/notifications") ||
        // Investments depend on transactions for amount, splits, and the
        // BUY/SELL history surfaced on detail pages. Without this, edits
        // to a holding leave the list/detail SWR caches stale.
        key.startsWith("/api/investments")
      );
    },
    undefined,
    { revalidate: true }
  );
}
