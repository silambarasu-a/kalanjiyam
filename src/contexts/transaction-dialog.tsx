"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type TransactionDefault =
  | "INCOME"
  | "EXPENSE"
  | "TRANSFER"
  | "LOAN"
  | "INVESTMENT";

export type OpenDialogOptions = {
  /** When opening on the INVESTMENT tab, start in "create new holding" mode
   * rather than the default "add txn to existing holding" picker. */
  defaultCreatingNew?: boolean;
};

type Ctx = {
  open: boolean;
  defaultType: TransactionDefault;
  defaultCreatingNew: boolean;
  openDialog: (type?: TransactionDefault, options?: OpenDialogOptions) => void;
  closeDialog: () => void;
};

const TransactionDialogContext = createContext<Ctx | null>(null);

export function TransactionDialogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [defaultType, setDefaultType] = useState<TransactionDefault>("EXPENSE");
  const [defaultCreatingNew, setDefaultCreatingNew] = useState(false);

  const openDialog = useCallback(
    (type?: TransactionDefault, options?: OpenDialogOptions) => {
      if (type) setDefaultType(type);
      setDefaultCreatingNew(options?.defaultCreatingNew ?? false);
      setOpen(true);
    },
    [],
  );
  const closeDialog = useCallback(() => setOpen(false), []);

  const value = useMemo(
    () => ({ open, defaultType, defaultCreatingNew, openDialog, closeDialog }),
    [open, defaultType, defaultCreatingNew, openDialog, closeDialog]
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
