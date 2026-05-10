"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type TransactionDefault =
  | "INCOME"
  | "EXPENSE"
  | "REFUND"
  | "TRANSFER"
  | "LOAN"
  | "INVESTMENT";

export type OpenDialogOptions = {
  /** When opening on the INVESTMENT tab, start in "create new holding" mode
   * rather than the default "add txn to existing holding" picker. */
  defaultCreatingNew?: boolean;
  /** When set, the INVESTMENT form opens in edit mode for that holding —
   * fields are pre-filled from the existing investment + its BUY splits,
   * and submit calls PATCH instead of POST. Implies create-new layout. */
  editingInvestmentId?: string;
};

type Ctx = {
  open: boolean;
  defaultType: TransactionDefault;
  defaultCreatingNew: boolean;
  editingInvestmentId: string | null;
  openDialog: (type?: TransactionDefault, options?: OpenDialogOptions) => void;
  closeDialog: () => void;
};

const TransactionDialogContext = createContext<Ctx | null>(null);

export function TransactionDialogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [defaultType, setDefaultType] = useState<TransactionDefault>("EXPENSE");
  const [defaultCreatingNew, setDefaultCreatingNew] = useState(false);
  const [editingInvestmentId, setEditingInvestmentId] = useState<string | null>(null);

  const openDialog = useCallback(
    (type?: TransactionDefault, options?: OpenDialogOptions) => {
      if (type) setDefaultType(type);
      const editing = options?.editingInvestmentId ?? null;
      setEditingInvestmentId(editing);
      // Edit mode always uses the new-holding layout (the picker doesn't
      // make sense when you're editing a specific known holding).
      setDefaultCreatingNew(editing != null || (options?.defaultCreatingNew ?? false));
      setOpen(true);
    },
    [],
  );
  const closeDialog = useCallback(() => {
    setOpen(false);
    setEditingInvestmentId(null);
  }, []);

  const value = useMemo(
    () => ({
      open,
      defaultType,
      defaultCreatingNew,
      editingInvestmentId,
      openDialog,
      closeDialog,
    }),
    [open, defaultType, defaultCreatingNew, editingInvestmentId, openDialog, closeDialog]
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
