"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Upload, AlertTriangle, FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

/**
 * Bulk-import historical livestock batches via paste-CSV. Self-contained
 * — no external CSV dep. Auto-detects column headers and shows a
 * preview table with per-row validation before the user commits.
 */
const PRODUCTION_TYPES = [
  "BROILER_CONTRACT",
  "BROILER_INDEPENDENT",
  "LAYER",
  "COUNTRY_CHICKEN",
  "DAIRY",
  "MEAT_GOAT",
  "MEAT_SHEEP",
  "DUAL_PURPOSE",
] as const;

type BatchRow = {
  livestockName: string;
  batchName: string;
  productionType?: string;
  startDate: string;
  endDate?: string;
  expectedCycleDays?: number;
  initialCount: number;
  currentCount?: number;
  initialAvgWeight?: number;
  targetWeight?: number;
  targetFCR?: number;
  notes?: string;
  active?: boolean;
};
type FeedRow = {
  batchName: string;
  date: string;
  amount: number;
  quantity?: number;
  unit?: string;
  notes?: string;
};
type WeighingRow = {
  batchName: string;
  date: string;
  phase?: string;
  sampleSize?: number;
  totalKg: number;
  notes?: string;
};
type MortalityRow = {
  batchName: string;
  date: string;
  count?: number;
  cause?: string;
  culled?: boolean;
  notes?: string;
};

type ParsedRow = {
  index: number; // 1-based original row index
  raw: Record<string, string>;
  parsed:
    | BatchRow
    | FeedRow
    | WeighingRow
    | MortalityRow
    | null;
  error: string | null;
  display: {
    col1: string;
    col2: string;
    col3: string;
    col4: string;
    col5: string;
  };
};

const HEADER_ALIASES: Record<string, string> = {
  livestockname: "livestockName",
  livestock: "livestockName",
  kind: "livestockName",
  species: "livestockName",
  batchname: "batchName",
  batch: "batchName",
  name: "batchName",
  productiontype: "productionType",
  type: "productionType",
  startdate: "startDate",
  started: "startDate",
  start: "startDate",
  enddate: "endDate",
  ended: "endDate",
  end: "endDate",
  cycledays: "expectedCycleDays",
  cycle: "expectedCycleDays",
  expectedcycledays: "expectedCycleDays",
  count: "count",
  initialcount: "initialCount",
  birds: "initialCount",
  head: "initialCount",
  currentcount: "currentCount",
  current: "currentCount",
  arrivalweight: "initialAvgWeight",
  initialavgweight: "initialAvgWeight",
  startweight: "initialAvgWeight",
  targetweight: "targetWeight",
  exitweight: "targetWeight",
  targetfcr: "targetFCR",
  fcr: "targetFCR",
  notes: "notes",
  remarks: "notes",
  active: "active",
  // log-import aliases
  date: "date",
  amount: "amount",
  cost: "amount",
  quantity: "quantity",
  qty: "quantity",
  unit: "unit",
  phase: "phase",
  samplesize: "sampleSize",
  sample: "sampleSize",
  totalkg: "totalKg",
  weightkg: "totalKg",
  cause: "cause",
  culled: "culled",
};

type ImportEntity = "batches" | "feed" | "weighings" | "mortality";

const ENTITY_OPTIONS: { value: ImportEntity; label: string; hint: string }[] = [
  {
    value: "batches",
    label: "Batches",
    hint: "livestockName, batchName, productionType, startDate, initialCount, …",
  },
  {
    value: "feed",
    label: "Feed logs",
    hint: "batchName, date, amount, quantity, unit, notes",
  },
  {
    value: "weighings",
    label: "Weighings",
    hint: "batchName, date, phase, sampleSize, totalKg, notes",
  },
  {
    value: "mortality",
    label: "Mortality",
    hint: "batchName, date, count, cause, culled, notes",
  },
];

export function BulkImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const [entity, setEntity] = useState<ImportEntity>("batches");
  const [csvText, setCsvText] = useState("");
  const [createMissingLivestock, setCreateMissingLivestock] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => parseCsv(csvText, entity), [csvText, entity]);
  const validRows = preview.rows.filter((r) => r.parsed && !r.error);
  const errorCount = preview.rows.filter((r) => r.error).length;
  const entityMeta =
    ENTITY_OPTIONS.find((e) => e.value === entity) ?? ENTITY_OPTIONS[0];

  async function importRows() {
    setError(null);
    if (validRows.length === 0) {
      setError("Nothing to import — fix the row errors first");
      return;
    }
    setSubmitting(true);
    try {
      const url =
        entity === "batches"
          ? "/api/livestock-batches/import"
          : "/api/livestock-batches/import-logs";
      const payload =
        entity === "batches"
          ? {
              rows: validRows.map((r) => r.parsed),
              createMissingLivestock,
            }
          : {
              entity,
              rows: validRows.map((r) => r.parsed),
            };
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Import failed");
        return;
      }
      toast.success(
        entity === "batches"
          ? `Imported ${body.imported} batch${body.imported === 1 ? "" : "es"}` +
              (body.newLivestock?.length
                ? ` (created ${body.newLivestock.length} new livestock kinds)`
                : "")
          : `Imported ${body.imported} ${entity} row${body.imported === 1 ? "" : "s"}`,
      );
      onOpenChange(false);
      onImported();
    } finally {
      setSubmitting(false);
    }
  }

  function loadFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4" /> Bulk import batches
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">What are you importing?</Label>
            <NativeSelect
              value={entity}
              onChange={(v) => {
                setEntity(v as ImportEntity);
                setError(null);
              }}
              options={ENTITY_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
              }))}
            />
          </div>
          <div className="rounded-md border bg-muted/30 p-3 text-[11px] text-muted-foreground">
            Paste CSV or upload a `.csv` file. Header row required. Recognised
            columns: <code className="font-mono">{entityMeta.hint}</code>. Common
            aliases (kind, batch, start, count, fcr…) are auto-mapped.{" "}
            {entity !== "batches" && (
              <>
                Each row links to an <b>existing</b> batch by name — import
                batches first if needed.
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Label className="text-xs" htmlFor="bulk-csv-file">
              Upload file
            </Label>
            <input
              id="bulk-csv-file"
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) loadFile(f);
              }}
              className="text-xs"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Or paste CSV here</Label>
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              spellCheck={false}
              className="h-40 w-full rounded-lg border bg-card p-2 font-mono text-[11px]"
              placeholder={`livestockName,batchName,productionType,startDate,initialCount,initialAvgWeight,targetWeight,targetFCR
Broiler,Apr-2026,BROILER_CONTRACT,2026-04-01,1000,0.045,2.2,1.7
Goat,Round-1,MEAT_GOAT,2026-03-15,20`}
            />
          </div>

          {entity === "batches" && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={createMissingLivestock}
                onChange={(e) => setCreateMissingLivestock(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              <span>
                Auto-create missing livestock kinds (otherwise the import fails
                when a row references one that doesn&rsquo;t exist).
              </span>
            </label>
          )}

          {preview.headerError && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-[11px] dark:border-amber-900 dark:bg-amber-950/40">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-amber-600" />
              <span>{preview.headerError}</span>
            </div>
          )}

          {preview.rows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <h3 className="text-xs font-semibold">
                  Preview ({preview.rows.length} row
                  {preview.rows.length === 1 ? "" : "s"})
                </h3>
                <span className="text-[10px] text-muted-foreground">
                  {validRows.length} ready · {errorCount} with errors
                </span>
              </div>
              <div className="max-h-72 overflow-auto rounded-xl border bg-card">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 border-b bg-muted/60 text-[9px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">#</th>
                      {previewHeaders(entity).map((h, i) => (
                        <th
                          key={h}
                          className={`px-2 py-1.5 ${i === 3 ? "text-right" : "text-left"} font-medium`}
                        >
                          {h}
                        </th>
                      ))}
                      <th className="px-2 py-1.5 text-left font-medium">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {preview.rows.map((r) => (
                      <tr
                        key={r.index}
                        className={r.error ? "bg-destructive/5" : ""}
                      >
                        <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                          {r.index}
                        </td>
                        <td className="px-2 py-1.5">{r.display.col1}</td>
                        <td className="px-2 py-1.5">{r.display.col2}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {r.display.col3}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {r.display.col4}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {r.display.col5}
                        </td>
                        <td className="px-2 py-1.5">
                          {r.error ? (
                            <span className="text-[10px] text-destructive">
                              {r.error}
                            </span>
                          ) : (
                            <span className="text-[10px] text-emerald-700 dark:text-emerald-400">
                              ready
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={importRows}
            disabled={submitting || validRows.length === 0}
            className="gap-1.5"
          >
            <FileText className="h-3.5 w-3.5" />
            {submitting
              ? "Importing…"
              : `Import ${validRows.length} batch${validRows.length === 1 ? "" : "es"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// CSV parser ----------------------------------------------------------
// RFC 4180-ish: handles quoted values + embedded commas + escaped
// double quotes (""). Returns the parsed table; downstream code maps
// header → schema and validates each row.

const REQUIRED_COLS: Record<ImportEntity, string[]> = {
  batches: ["livestockName", "batchName", "startDate", "initialCount"],
  feed: ["batchName", "date", "amount"],
  weighings: ["batchName", "date", "totalKg"],
  mortality: ["batchName", "date"],
};

function parseCsv(
  text: string,
  entity: ImportEntity,
): {
  headerError: string | null;
  rows: ParsedRow[];
} {
  const trimmed = text.trim();
  if (!trimmed) return { headerError: null, rows: [] };

  const table = csvToTable(trimmed);
  if (table.length < 2) {
    return {
      headerError: "Need a header row plus at least one data row",
      rows: [],
    };
  }

  const headers = table[0].map((h) =>
    HEADER_ALIASES[h.trim().toLowerCase().replace(/\s|_/g, "")] ?? "",
  );
  const missing = REQUIRED_COLS[entity].filter((c) => !headers.includes(c));
  if (missing.length > 0) {
    return {
      headerError: `Header is missing required column${missing.length === 1 ? "" : "s"} for ${entity}: ${missing.join(", ")}`,
      rows: [],
    };
  }

  const dataRows: ParsedRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    if (cells.every((c) => c.trim() === "")) continue;
    const raw: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j];
      if (!key) continue;
      raw[key] = (cells[j] ?? "").trim();
    }
    dataRows.push(validateRow(i + 1, raw, entity));
  }
  return { headerError: null, rows: dataRows };
}

function csvToTable(text: string): string[][] {
  const rows: string[][] = [[]];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      rows[rows.length - 1].push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      rows[rows.length - 1].push(field);
      field = "";
      if (ch === "\r" && text[i + 1] === "\n") i++;
      rows.push([]);
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || rows[rows.length - 1].length > 0) {
    rows[rows.length - 1].push(field);
  }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

const CAUSES = [
  "UNKNOWN",
  "DISEASE",
  "PREDATOR",
  "INJURY",
  "HEAT",
  "COLD",
  "STAMPEDE",
  "OTHER",
] as const;
const PHASES = ["ARRIVAL", "INTERIM", "WEEKLY", "EXIT"] as const;

function validateRow(
  index: number,
  raw: Record<string, string>,
  entity: ImportEntity,
): ParsedRow {
  if (entity === "batches") return validateBatchRow(index, raw);
  if (entity === "feed") return validateFeedRow(index, raw);
  if (entity === "weighings") return validateWeighingRow(index, raw);
  return validateMortalityRow(index, raw);
}

function validateBatchRow(
  index: number,
  raw: Record<string, string>,
): ParsedRow {
  const livestockName = raw.livestockName ?? "";
  const batchName = raw.batchName ?? "";
  if (!livestockName)
    return mkErr(index, raw, "livestockName is required");
  if (!batchName) return mkErr(index, raw, "batchName is required");
  const startDate = raw.startDate ?? "";
  if (!startDate) return mkErr(index, raw, "startDate is required");
  if (Number.isNaN(new Date(startDate).getTime()))
    return mkErr(index, raw, `invalid startDate "${startDate}"`);
  const initialCountRaw = raw.initialCount ?? "";
  const initialCount = Number(initialCountRaw);
  if (!Number.isFinite(initialCount) || initialCount < 0)
    return mkErr(index, raw, "initialCount must be a non-negative number");

  const productionType = raw.productionType
    ? raw.productionType.trim().toUpperCase()
    : undefined;
  if (
    productionType &&
    !(PRODUCTION_TYPES as readonly string[]).includes(productionType)
  ) {
    return mkErr(
      index,
      raw,
      `productionType "${productionType}" not recognised`,
    );
  }
  const endDate = raw.endDate?.trim() || undefined;
  if (endDate && Number.isNaN(new Date(endDate).getTime()))
    return mkErr(index, raw, `invalid endDate "${endDate}"`);
  const expectedCycleDays = numOrUndef(raw.expectedCycleDays);
  const currentCount = numOrUndef(raw.currentCount);
  const initialAvgWeight = numOrUndef(raw.initialAvgWeight);
  const targetWeight = numOrUndef(raw.targetWeight);
  const targetFCR = numOrUndef(raw.targetFCR);
  const activeRaw = raw.active?.trim().toLowerCase();
  const active =
    activeRaw === undefined || activeRaw === ""
      ? undefined
      : ["true", "1", "yes", "y"].includes(activeRaw);

  return {
    index,
    raw,
    parsed: {
      livestockName,
      batchName,
      productionType,
      startDate,
      endDate,
      expectedCycleDays,
      initialCount: Math.trunc(initialCount),
      currentCount:
        currentCount != null ? Math.trunc(currentCount) : undefined,
      initialAvgWeight,
      targetWeight,
      targetFCR,
      notes: raw.notes?.trim() || undefined,
      active,
    },
    error: null,
    display: {
      col1: livestockName,
      col2: batchName,
      col3: productionType ?? "DUAL_PURPOSE",
      col4: startDate,
      col5: String(Math.trunc(initialCount)),
    },
  };
}

function validateFeedRow(
  index: number,
  raw: Record<string, string>,
): ParsedRow {
  const batchName = raw.batchName ?? "";
  const date = raw.date ?? "";
  if (!batchName) return mkErr(index, raw, "batchName is required");
  if (!date) return mkErr(index, raw, "date is required");
  if (Number.isNaN(new Date(date).getTime()))
    return mkErr(index, raw, `invalid date "${date}"`);
  const amount = Number(raw.amount ?? "");
  if (!Number.isFinite(amount) || amount <= 0)
    return mkErr(index, raw, "amount must be a positive number");
  const quantity = numOrUndef(raw.quantity);
  return {
    index,
    raw,
    parsed: {
      batchName,
      date,
      amount,
      quantity,
      unit: raw.unit?.trim() || undefined,
      notes: raw.notes?.trim() || undefined,
    },
    error: null,
    display: {
      col1: batchName,
      col2: date,
      col3: quantity != null ? `${quantity}${raw.unit ? ` ${raw.unit}` : ""}` : "—",
      col4: `₹${amount}`,
      col5: raw.notes?.slice(0, 24) ?? "",
    },
  };
}

function validateWeighingRow(
  index: number,
  raw: Record<string, string>,
): ParsedRow {
  const batchName = raw.batchName ?? "";
  const date = raw.date ?? "";
  if (!batchName) return mkErr(index, raw, "batchName is required");
  if (!date) return mkErr(index, raw, "date is required");
  if (Number.isNaN(new Date(date).getTime()))
    return mkErr(index, raw, `invalid date "${date}"`);
  const totalKg = Number(raw.totalKg ?? "");
  if (!Number.isFinite(totalKg) || totalKg <= 0)
    return mkErr(index, raw, "totalKg must be a positive number");
  const phaseRaw = raw.phase?.trim().toUpperCase();
  const phase =
    phaseRaw && (PHASES as readonly string[]).includes(phaseRaw)
      ? phaseRaw
      : phaseRaw
        ? undefined
        : undefined;
  if (phaseRaw && !(PHASES as readonly string[]).includes(phaseRaw))
    return mkErr(index, raw, `phase "${phaseRaw}" not recognised`);
  const sampleSize = numOrUndef(raw.sampleSize);
  return {
    index,
    raw,
    parsed: {
      batchName,
      date,
      phase,
      sampleSize: sampleSize != null ? Math.trunc(sampleSize) : undefined,
      totalKg,
      notes: raw.notes?.trim() || undefined,
    },
    error: null,
    display: {
      col1: batchName,
      col2: date,
      col3: phase ?? "INTERIM",
      col4: `${totalKg} kg`,
      col5: sampleSize != null ? `n=${Math.trunc(sampleSize)}` : "n=1",
    },
  };
}

function validateMortalityRow(
  index: number,
  raw: Record<string, string>,
): ParsedRow {
  const batchName = raw.batchName ?? "";
  const date = raw.date ?? "";
  if (!batchName) return mkErr(index, raw, "batchName is required");
  if (!date) return mkErr(index, raw, "date is required");
  if (Number.isNaN(new Date(date).getTime()))
    return mkErr(index, raw, `invalid date "${date}"`);
  const countRaw = raw.count ?? "";
  const count = countRaw === "" ? 1 : Number(countRaw);
  if (!Number.isFinite(count) || count <= 0)
    return mkErr(index, raw, "count must be a positive integer");
  const causeRaw = raw.cause?.trim().toUpperCase();
  if (causeRaw && !(CAUSES as readonly string[]).includes(causeRaw))
    return mkErr(index, raw, `cause "${causeRaw}" not recognised`);
  const culledRaw = raw.culled?.trim().toLowerCase();
  const culled =
    culledRaw && ["true", "1", "yes", "y"].includes(culledRaw)
      ? true
      : undefined;
  return {
    index,
    raw,
    parsed: {
      batchName,
      date,
      count: Math.trunc(count),
      cause: causeRaw,
      culled,
      notes: raw.notes?.trim() || undefined,
    },
    error: null,
    display: {
      col1: batchName,
      col2: date,
      col3: causeRaw ?? "UNKNOWN",
      col4: String(Math.trunc(count)),
      col5: culled ? "culled" : "death",
    },
  };
}

function numOrUndef(s: string | undefined): number | undefined {
  if (s === undefined || s.trim() === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function previewHeaders(entity: ImportEntity): string[] {
  switch (entity) {
    case "batches":
      return ["Livestock", "Batch", "Type", "Count", "Start"];
    case "feed":
      return ["Batch", "Date", "Quantity", "Amount", "Notes"];
    case "weighings":
      return ["Batch", "Date", "Phase", "Total kg", "Sample"];
    case "mortality":
      return ["Batch", "Date", "Cause", "Count", "Kind"];
  }
}

function mkErr(
  index: number,
  raw: Record<string, string>,
  msg: string,
): ParsedRow {
  return {
    index,
    raw,
    parsed: null,
    error: msg,
    display: {
      col1: raw.batchName ?? raw.livestockName ?? "—",
      col2: raw.date ?? raw.startDate ?? "—",
      col3: "—",
      col4: "—",
      col5: "—",
    },
  };
}
