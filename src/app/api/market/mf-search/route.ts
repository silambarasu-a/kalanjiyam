import { NextResponse } from "next/server";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

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

interface Scheme extends MfSearchResult {
  /** Precomputed lowercase "name fundHouse" haystack for filtering. */
  searchText: string;
}

// AMFI publishes every scheme's NAV as one ~1.6MB semicolon-delimited text
// file (~14k schemes). We pull it once and serve searches from memory —
// there is no official search API. www.amfiindia.com redirects here.
const AMFI_NAV_URL = "https://portal.amfiindia.com/spages/NAVAll.txt";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

let cache: { schemes: Scheme[]; fetchedAt: number } | null = null;
// Deduplicate concurrent cold-cache fetches (two users typing at once).
let inflight: Promise<Scheme[]> | null = null;

/**
 * NAVAll.txt line grammar:
 *   - header row naming the columns (contains ";" but a non-numeric first field)
 *   - "Open Ended Schemes(Debt Scheme - ...)" style category banners
 *   - bare fund-house lines ("Axis Mutual Fund") that scope the rows below
 *   - scheme rows: code;isin1;isin2;name;nav;date
 */
function parseNavAll(text: string): Scheme[] {
  const schemes: Scheme[] = [];
  let fundHouse = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.includes(";")) {
      const parts = line.split(";");
      if (parts.length < 6 || !/^\d+$/.test(parts[0])) continue;
      const name = parts[3].replace(/\s+/g, " ").trim();
      if (!name) continue;
      const nav = parseFloat(parts[4]);
      schemes.push({
        schemeCode: parts[0],
        name,
        fundHouse,
        nav: Number.isFinite(nav) ? nav : null,
        navDate: parts[5]?.trim() || null,
        searchText: `${name} ${fundHouse}`.toLowerCase(),
      });
    } else if (!/Schemes\s*\(/i.test(line)) {
      fundHouse = line;
    }
  }
  return schemes;
}

async function loadSchemes(): Promise<Scheme[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.schemes;
  }
  if (!inflight) {
    inflight = (async () => {
      try {
        const res = await fetch(AMFI_NAV_URL, {
          signal: AbortSignal.timeout(20_000),
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`AMFI responded ${res.status}`);
        const schemes = parseNavAll(await res.text());
        if (schemes.length === 0) throw new Error("AMFI feed parsed to zero schemes");
        cache = { schemes, fetchedAt: Date.now() };
        return schemes;
      } catch (e) {
        // Serve a stale list over an empty dropdown — fund names barely churn.
        if (cache) return cache.schemes;
        throw e;
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
}

export async function GET(request: Request) {
  try {
    await requireWorkspace("investments", "read");

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim().toLowerCase() ?? "";
    if (q.length < 2) return NextResponse.json([]);

    const schemes = await loadSchemes();
    const tokens = q.split(/\s+/).filter(Boolean);
    const ranked = schemes
      .filter((s) => tokens.every((t) => s.searchText.includes(t)))
      .sort((a, b) => {
        const rank = (s: Scheme) => {
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
