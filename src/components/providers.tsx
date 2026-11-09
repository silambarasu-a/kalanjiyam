"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TransactionDialogProvider } from "@/contexts/transaction-dialog";
import { LockOverrideProvider } from "@/contexts/lock-override";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <SessionProvider refetchInterval={60}>
        <LockOverrideProvider>
          <TransactionDialogProvider>
            {children}
            <Toaster richColors closeButton position="top-right" />
          </TransactionDialogProvider>
        </LockOverrideProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
