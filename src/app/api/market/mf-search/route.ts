import { NextResponse } from "next/server";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { loadAmfiSchemes, type AmfiScheme } from "@/lib/amfi";

export interface MfSearchResult {
  /** AMFI scheme code — stable id, usable later for NAV lookups. */
  schemeCode: string;
  /** Official scheme name as published in the AMFI NAV feed. */
  name: string;
  /** AMC, e.g. "HDFC Mutual Fund". */
  fundHouse: string;
  /** Latest NAV (₹). Null when AMFI reports "N.A.". */
  nav: number | null;
  /** NAV as-of date, AMFI's own "04-Aug-2026" format. */
  navDate: string | null;
}

export async function GET(request: Request) {
  try {
    await requireWorkspace("investments", "read");

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim().toLowerCase() ?? "";
    if (q.length < 2) return NextResponse.json([]);

    const schemes = await loadAmfiSchemes();
    const tokens = q.split(/\s+/).filter(Boolean);
    const ranked = schemes
      .filter((s) => tokens.every((t) => s.searchText.includes(t)))
      .sort((a, b) => {
        const rank = (s: AmfiScheme) => {
          const n = s.name.toLowerCase();
          if (n.startsWith(q)) return 0;
          if (n.includes(q)) return 1;
          return 2;
        };
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 15)
      .map(
        (s): MfSearchResult => ({
          schemeCode: s.schemeCode,
          name: s.name,
          fundHouse: s.fundHouse,
          nav: s.nav,
          navDate: s.navDate,
        }),
      );

    return NextResponse.json(ranked);
  } catch (e) {
    if (e instanceof WorkspaceAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[mf-search]", e);
    return NextResponse.json(
      { error: "Couldn't load the AMFI fund list" },
      { status: 502 },
    );
  }
}
