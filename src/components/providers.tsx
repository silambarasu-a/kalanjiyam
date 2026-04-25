"use client";

import { SessionProvider } from "next-auth/react";
import { Toaster } from "@/components/ui/sonner";
import { TransactionDialogProvider } from "@/contexts/transaction-dialog";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchInterval={60}>
      <TransactionDialogProvider>
        {children}
        <Toaster richColors closeButton position="top-right" />
      </TransactionDialogProvider>
    </SessionProvider>
  );
}
