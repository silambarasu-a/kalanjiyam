"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type TransactionDefault =
  | "INCOME"
  | "EXPENSE"
  | "REFUND"
  | "TRANSFER"
  | "LOAN"
  | "INVESTMENT";

/** Context for paying an insurance premium through the shared transaction
 * dialog (replaces the old standalone reminder Confirm dialog for premiums).
 * When set, the INVESTMENT tab opens pre-targeted at the policy: the holding
 * is preselected, action is BUY, the premium breakdown drives the amount, and
 * on submit the linked reminder is confirmed + the policy's next-due rolls
 * forward. */
export type PremiumPaymentContext = {
  investmentId: string;
  reminderId?: string;
  /** Prefill hint for the amount (falls back to the policy's premium). */
  amount?: number;
};

export type OpenDialogOptions = {
  /** When opening on the INVESTMENT tab, start in "create new holding" mode
   * rather than the default "add txn to existing holding" picker. */
  defaultCreatingNew?: boolean;
  /** When set, the INVESTMENT form opens in edit mode for that holding —
   * fields are pre-filled from the existing investment + its BUY splits,
   * and submit calls PATCH instead of POST. Implies create-new layout. */
  editingInvestmentId?: string;
  /** When set, the INVESTMENT form opens pre-targeted at paying this
   * insurance policy's premium (see PremiumPaymentContext). */
  premiumPayment?: PremiumPaymentContext;
};

type Ctx = {
  open: boolean;
  defaultType: TransactionDefault;
  defaultCreatingNew: boolean;
  editingInvestmentId: string | null;
  premiumPayment: PremiumPaymentContext | null;
  openDialog: (type?: TransactionDefault, options?: OpenDialogOptions) => void;
  closeDialog: () => void;
};

const TransactionDialogContext = createContext<Ctx | null>(null);

export function TransactionDialogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [defaultType, setDefaultType] = useState<TransactionDefault>("EXPENSE");
  const [defaultCreatingNew, setDefaultCreatingNew] = useState(false);
  const [editingInvestmentId, setEditingInvestmentId] = useState<string | null>(null);
  const [premiumPayment, setPremiumPayment] = useState<PremiumPaymentContext | null>(
    null,
  );

  const openDialog = useCallback(
    (type?: TransactionDefault, options?: OpenDialogOptions) => {
      if (type) setDefaultType(type);
      const editing = options?.editingInvestmentId ?? null;
      setEditingInvestmentId(editing);
      setPremiumPayment(options?.premiumPayment ?? null);
      // Edit mode always uses the new-holding layout (the picker doesn't
      // make sense when you're editing a specific known holding). A premium
      // payment targets an existing holding, so it stays in picker mode.
      setDefaultCreatingNew(editing != null || (options?.defaultCreatingNew ?? false));
      setOpen(true);
    },
    [],
  );
  const closeDialog = useCallback(() => {
    setOpen(false);
    setEditingInvestmentId(null);
    setPremiumPayment(null);
  }, []);

  const value = useMemo(
    () => ({
      open,
      defaultType,
      defaultCreatingNew,
      editingInvestmentId,
      premiumPayment,
      openDialog,
      closeDialog,
    }),
    [
      open,
      defaultType,
      defaultCreatingNew,
      editingInvestmentId,
      premiumPayment,
      openDialog,
      closeDialog,
    ]
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
