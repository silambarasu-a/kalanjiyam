import { LoansView } from "@/components/loans/loans-view";

// Money you lent out. Sits under /loans/hand so the sidebar's longest-prefix
// match keeps "Hand Loans" highlighted — same feature, same permission key, no
// extra nav entry. The Borrowed | Lent toggle inside LoansView links the pair.
export default function LentHandLoansPage() {
  return <LoansView source="HAND_FORMAL" direction="LENT" />;
}
