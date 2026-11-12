"use client";

import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  BrokerageFundDialog,
  type BrokerageWallet,
  type FundDirection,
} from "@/components/investments/brokerage-fund-dialog";

/**
 * "Add funds" / "Withdraw" for one brokerage wallet — the client island the
 * (server-rendered) account page drops into its header. The dialog refreshes
 * the route on success, so the page's balance and statement update with it.
 */
export function BrokerageWalletActions({ brokerage }: { brokerage: BrokerageWallet }) {
  const [direction, setDirection] = useState<FundDirection | null>(null);
  return (
    <>
      <div className="flex gap-2">
        <Button size="sm" className="gap-1.5" onClick={() => setDirection("deposit")}>
          <ArrowDownToLine className="h-3.5 w-3.5" /> Add funds
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={!(brokerage.nativeBalance > 0)}
          onClick={() => setDirection("withdraw")}
        >
          <ArrowUpFromLine className="h-3.5 w-3.5" /> Withdraw
        </Button>
      </div>
      <BrokerageFundDialog
        open={direction !== null}
        onClose={() => setDirection(null)}
        brokerage={brokerage}
        direction={direction ?? "deposit"}
      />
    </>
  );
}
