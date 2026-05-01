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
        key.startsWith("/api/notifications")
      );
    },
    undefined,
    { revalidate: true }
  );
}
