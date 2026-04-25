"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type TransactionDefault = "INCOME" | "EXPENSE" | "TRANSFER";

type Ctx = {
  open: boolean;
  defaultType: TransactionDefault;
  openDialog: (type?: TransactionDefault) => void;
  closeDialog: () => void;
};

const TransactionDialogContext = createContext<Ctx | null>(null);

export function TransactionDialogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [defaultType, setDefaultType] = useState<TransactionDefault>("EXPENSE");

  const openDialog = useCallback((type?: TransactionDefault) => {
    if (type) setDefaultType(type);
    setOpen(true);
  }, []);
  const closeDialog = useCallback(() => setOpen(false), []);

  const value = useMemo(
    () => ({ open, defaultType, openDialog, closeDialog }),
    [open, defaultType, openDialog, closeDialog]
  );

  return (
    <TransactionDialogContext.Provider value={value}>
      {children}
    </TransactionDialogContext.Provider>
  );
}

export function useTransactionDialog() {
  const ctx = useContext(TransactionDialogContext);
  if (!ctx) throw new Error("useTransactionDialog must be used within TransactionDialogProvider");
  return ctx;
}
