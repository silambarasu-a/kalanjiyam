"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { NativeSelect } from "@/components/ui/native-select";
import { DateInput } from "@/components/ui/date-input";
import { Button } from "@/components/ui/button";
import type { Period } from "@/lib/statement-period";

type Props = {
  /** Pre-computed list of recent periods to step through. Newest first. */
  periods: Period[];
  /** Currently active period id (or "custom:<from>_<to>"). */
  activeId: string;
  /** When in custom mode, the from/to currently in effect (ISO yyyy-mm-dd). */
  customFrom?: string;
  customTo?: string;
};

/**
 * Renders a period dropdown + Custom-range pickers. On change, rewrites the
 * `period` (and `from` / `to` for custom) search params so the parent server
 * page re-renders with the new filter.
 */
export function PeriodFilter({ periods, activeId, customFrom, customTo }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  const isCustom = activeId === "custom";
  const [from, setFrom] = useState(customFrom ?? "");
  const [to, setTo] = useState(customTo ?? "");

  function pushParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === "") params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="w-full sm:min-w-56 sm:w-auto">
        <NativeSelect
          value={activeId}
          onChange={(next) => {
            if (next === "custom") {
              pushParams({ period: "custom" });
            } else {
              pushParams({ period: next, from: null, to: null });
            }
          }}
          options={[
            ...periods.map((p, i) => ({
              value: p.id,
              label: p.label,
              hint: p.hint,
              disabled: false,
              // Mark the first one as default-current so the dropdown opens
              // showing it pre-selected when activeId is empty.
              ...(i === 0 ? {} : {}),
            })),
            { value: "custom", label: "Custom range…" },
          ]}
        />
      </div>

      {isCustom && (
        <div className="flex items-center gap-2">
          <DateInput value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-xs text-muted-foreground">to</span>
          <DateInput value={to} onChange={(e) => setTo(e.target.value)} />
          <Button
            type="button"
            size="sm"
            disabled={pending || !from || !to}
            onClick={() => pushParams({ period: "custom", from, to })}
          >
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}
