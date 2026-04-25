import { Sidebar } from "./sidebar";
import { BottomNav } from "./bottom-nav";
import { Header, MobileHeader } from "./header";
import { SessionGuard } from "@/components/session-guard";
import { TransactionDialog } from "@/components/transactions/transaction-dialog";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[var(--muted)]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <MobileHeader />
        <main className="flex-1 overflow-x-hidden">
          <div className="mx-auto w-full max-w-6xl p-4 md:p-6">{children}</div>
        </main>
      </div>
      <BottomNav />
      <SessionGuard />
      <TransactionDialog />
    </div>
  );
}
