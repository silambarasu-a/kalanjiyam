"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TransactionDialogProvider } from "@/contexts/transaction-dialog";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <SessionProvider refetchInterval={60}>
        <TransactionDialogProvider>
          {children}
          <Toaster richColors closeButton position="top-right" />
        </TransactionDialogProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
