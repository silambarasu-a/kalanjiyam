"use client";

import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { PercentOrRupeeInput } from "@/components/ui/percent-or-rupee-input";
import { GoldBreakdown } from "@/components/investments/gold-breakdown";
import {
  GoldStonesRepeater,
  emptyStone,
  type StoneRow,
} from "@/components/investments/gold/gold-stones-repeater";
import { computeOrnamentLine, type OrnamentLine } from "@/lib/gold";
import { cn, formatINR } from "@/lib/utils";

export type OrnamentRow = {
  /** Present when editing an existing piece; absent means create. */
  id?: string;
  name: string;
  itemType: string;
  quantity: string;
  purity: string;
  grossWeightGrams: string;
  ratePerGram: string;
  stones: StoneRow[];
  wastageInput: string;
  wastageMode: "PERCENT" | "RUPEE";
  makingInput: string;
  makingMode: "PERCENT" | "RUPEE";
  cgstInput: string;
  cgstMode: "PERCENT" | "RUPEE";
  sgstInput: string;
  sgstMode: "PERCENT" | "RUPEE";
  roundOff: string;
  assignedContactId: string;
  boughtForContactId: string;
  declaredValue: string;
  openingCostBasis: string;
  notes: string;
};

export const emptyOrnament = (rate = ""): OrnamentRow => ({
  name: "",
  itemType: "",
  quantity: "1",
  purity: "22K",
  grossWeightGrams: "",
  ratePerGram: rate,
  stones: [],
  wastageInput: "",
  wastageMode: "PERCENT",
  makingInput: "",
  makingMode: "PERCENT",
  cgstInput: "1.5",
  cgstMode: "PERCENT",
  sgstInput: "1.5",
  sgstMode: "PERCENT",
  roundOff: "",
  assignedContactId: "",
  boughtForContactId: "",
  declaredValue: "",
  openingCostBasis: "",
  notes: "",
});

/** Numbers for one row, computed with the same code the server verifies with. */
export function lineOf(o: OrnamentRow): OrnamentLine {
  return computeOrnamentLine({
    grossWeightGrams: parseFloat(o.grossWeightGrams) || 0,
    ratePerGram: parseFloat(o.ratePerGram) || 0,
    stones: o.stones.map((s) => ({
      kind: s.kind || null,
      weight: parseFloat(s.weight) || 0,
      carats: parseFloat(s.carats) || null,
      ratePerCt: parseFloat(s.ratePerCt) || null,
      charge: parseFloat(s.charge) || 0,
    })),
    wastageInput: o.wastageInput,
    wastageMode: o.wastageMode,
    makingInput: o.makingInput,
    makingMode: o.makingMode,
    cgstInput: o.cgstInput,
    cgstMode: o.cgstMode,
    sgstInput: o.sgstInput,
    sgstMode: o.sgstMode,
    roundOff: parseFloat(o.roundOff) || 0,
  });
}

const PURITY_OPTIONS = ["24K", "22K", "18K", "14K", "OTHER"].map((v) => ({
  value: v,
  label: v,
}));

export function OrnamentLineEditor({
  index,
  ornament,
  onChange,
  onRemove,
  canRemove,
  contacts,
  acquisitionKind,
  expanded,
  onToggle,
}: {
  index: number;
  ornament: OrnamentRow;
  onChange: (next: OrnamentRow) => void;
  onRemove: () => void;
  canRemove: boolean;
  contacts: { id: string; name: string }[];
  acquisitionKind: "PURCHASE" | "GIFT_RECEIVED" | "OPENING_STOCK";
  expanded: boolean;
  onToggle: () => void;
}) {
  const line = lineOf(ornament);
  const set = (patch: Partial<OrnamentRow>) => onChange({ ...ornament, ...patch });
  const isTheirs = !!ornament.boughtForContactId;
  const contactOptions = [
    { value: "", label: "— none —" },
    ...contacts.map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <div
      className={cn(
        "rounded-xl border bg-card",
        isTheirs && "border-amber-400/60 dark:border-amber-500/40",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onToggle}
          aria-label={expanded ? "Collapse ornament" : "Expand ornament"}
          className="h-7 w-7 shrink-0"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </Button>
        <span className="text-xs font-medium text-muted-foreground tabular-nums">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {ornament.name || "Untitled ornament"}
          {ornament.grossWeightGrams && (
            <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
              {line.netWeightGrams}g {ornament.purity}
            </span>
          )}
        </span>
        {isTheirs && (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            Theirs
          </span>
        )}
        <span className="shrink-0 text-sm font-semibold tabular-nums">
          {formatINR(line.lineTotal)}
        </span>
        {canRemove && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onRemove}
            aria-label="Remove ornament"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {expanded && (
        <div className="space-y-3 border-t px-3 py-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="col-span-2">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input
                value={ornament.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Thali chain"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Input
                value={ornament.itemType}
                onChange={(e) => set({ itemType: e.target.value })}
                placeholder="Chain"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Count</Label>
              <Input
                type="number"
                min={1}
                value={ornament.quantity}
                onChange={(e) => set({ quantity: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div>
              <Label className="text-xs text-muted-foreground">Purity</Label>
              <NativeSelect
                value={ornament.purity}
                onChange={(v) => set({ purity: v })}
                options={PURITY_OPTIONS}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">
                Gross weight (g)
              </Label>
              <Input
                type="number"
                step="0.001"
                value={ornament.grossWeightGrams}
                onChange={(e) => set({ grossWeightGrams: e.target.value })}
                placeholder="0.000"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Rate ₹/g</Label>
              <Input
                type="number"
                step="0.01"
                value={ornament.ratePerGram}
                onChange={(e) => set({ ratePerGram: e.target.value })}
                placeholder="0.00"
              />
            </div>
          </div>

          <GoldStonesRepeater
            stones={ornament.stones}
            onChange={(stones) => set({ stones })}
          />

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div>
              <Label className="text-xs text-muted-foreground">Wastage</Label>
              <PercentOrRupeeInput
                value={ornament.wastageInput}
                onValueChange={(v) => set({ wastageInput: v })}
                mode={ornament.wastageMode}
                onModeChange={(m) => set({ wastageMode: m })}
                baseAmount={line.goldValue}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Making</Label>
              <PercentOrRupeeInput
                value={ornament.makingInput}
                onValueChange={(v) => set({ makingInput: v })}
                mode={ornament.makingMode}
                onModeChange={(m) => set({ makingMode: m })}
                baseAmount={line.goldValue}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">CGST</Label>
              <PercentOrRupeeInput
                value={ornament.cgstInput}
                onValueChange={(v) => set({ cgstInput: v })}
                mode={ornament.cgstMode}
                onModeChange={(m) => set({ cgstMode: m })}
                baseAmount={line.gstBase}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">SGST</Label>
              <PercentOrRupeeInput
                value={ornament.sgstInput}
                onValueChange={(v) => set({ sgstInput: v })}
                mode={ornament.sgstMode}
                onModeChange={(m) => set({ sgstMode: m })}
                baseAmount={line.gstBase}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Round-off</Label>
              <Input
                type="number"
                step="0.01"
                value={ornament.roundOff}
                onChange={(e) => set({ roundOff: e.target.value })}
                placeholder="0"
              />
            </div>
          </div>

          <GoldBreakdown
            weight={line.netWeightGrams}
            ratePerGram={parseFloat(ornament.ratePerGram) || 0}
            goldValue={line.goldValue}
            wastage={line.wastageAmount}
            making={line.makingAmount}
            cgst={line.cgstAmount}
            sgst={line.sgstAmount}
            roundOff={line.roundOff}
            stones={ornament.stones.map((s) => ({
              kind: s.kind || null,
              weight: parseFloat(s.weight) || 0,
              carats: parseFloat(s.carats) || undefined,
              ratePerCt: parseFloat(s.ratePerCt) || undefined,
              charge: parseFloat(s.charge) || 0,
            }))}
          />

          {/* Who it's for. Assigning keeps the piece yours; "bought for
              them" hands it over and books a receivable instead. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <Label className="text-xs text-muted-foreground">
                Assigned to {isTheirs && "(theirs already)"}
              </Label>
              <NativeSelect
                value={ornament.assignedContactId}
                onChange={(v) => set({ assignedContactId: v })}
                options={contactOptions}
                searchable
                disabled={isTheirs}
                placeholder="Who wears it"
              />
            </div>
            {acquisitionKind === "PURCHASE" && (
              <div>
                <Label className="text-xs text-muted-foreground">
                  Bought for (they repay you)
                </Label>
                <NativeSelect
                  value={ornament.boughtForContactId}
                  onChange={(v) =>
                    set({
                      boughtForContactId: v,
                      ...(v ? { assignedContactId: "" } : {}),
                    })
                  }
                  options={contactOptions}
                  searchable
                  placeholder="Nobody — it's mine"
                />
              </div>
            )}
          </div>

          {isTheirs && (
            <p className="rounded-md border border-amber-400/60 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-200">
              {formatINR(line.lineTotal)} they&apos;ll owe you. It&apos;s part of
              the bill total, so it&apos;s covered by the payment rows below
              like everything else.
            </p>
          )}

          {acquisitionKind === "GIFT_RECEIVED" && (
            <div>
              <Label className="text-xs text-muted-foreground">
                Value on the gift date (for reporting only — adds ₹0 to invested)
              </Label>
              <Input
                type="number"
                step="0.01"
                value={ornament.declaredValue}
                onChange={(e) => set({ declaredValue: e.target.value })}
                placeholder="0.00"
              />
            </div>
          )}

          {acquisitionKind === "OPENING_STOCK" && (
            <div>
              <Label className="text-xs text-muted-foreground">
                What you originally paid (leave blank if unknown)
              </Label>
              <Input
                type="number"
                step="0.01"
                value={ornament.openingCostBasis}
                onChange={(e) => set({ openingCostBasis: e.target.value })}
                placeholder="0.00"
              />
            </div>
          )}

          <div>
            <Label className="text-xs text-muted-foreground">Notes</Label>
            <Input
              value={ornament.notes}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder="Hallmark BIS 916, bought for Deepavali"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export { emptyStone };
