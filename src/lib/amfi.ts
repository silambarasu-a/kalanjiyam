/**
 * AMFI mutual-fund feed — server only.
 *
 * AMFI publishes every scheme's latest NAV as one ~1.6MB semicolon-delimited
 * text file (~14k schemes). There is no official search or per-scheme API,
 * so it is pulled once and served from memory: fund search filters it, and
 * holdings are valued by looking their scheme code up in it.
 */

export interface AmfiScheme {
  /** AMFI scheme code — stable id for the scheme. */
  schemeCode: string;
  /** Official scheme name as published in the AMFI NAV feed. */
  name: string;
  /** AMC, e.g. "HDFC Mutual Fund". */
  fundHouse: string;
  /** Latest NAV (₹). Null when AMFI reports "N.A.". */
  nav: number | null;
  /** NAV as-of date, AMFI's own "04-Aug-2026" format. */
  navDate: string | null;
  /** Precomputed lowercase "name fundHouse" haystack for filtering. */
  searchText: string;
}

/** Latest NAV for one scheme, as handed to the valuation code. */
export interface FundNav {
  nav: number;
  /** AMFI's "04-Aug-2026" format, or null when the feed omitted it. */
  navDate: string | null;
}

// www.amfiindia.com redirects here.
const AMFI_NAV_URL = "https://portal.amfiindia.com/spages/NAVAll.txt";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

let cache: {
  schemes: AmfiScheme[];
  byCode: Map<string, AmfiScheme>;
  fetchedAt: number;
} | null = null;
// Deduplicate concurrent cold-cache fetches (two users typing at once).
let inflight: Promise<AmfiScheme[]> | null = null;
// After a failed refresh, don't retry for a bit — otherwise a hanging AMFI
// makes every keystroke block on a fresh 20s attempt.
let lastFailureAt = 0;
const FAILURE_COOLDOWN_MS = 60_000;

/** Where each field sits in a scheme row. `plan` / `option` are -1 when absent. */
type Columns = { name: number; plan: number; option: number; nav: number; date: number };

/**
 * AMFI has served two layouts of this file:
 *
 *   code;isin;isin;name;nav;date               plan and option inside the name
 *   code;isin;isin;name;plan;option;nav;date   plan and option as columns
 *
 * Reading the wrong one doesn't fail loudly — it yields a NAV of NaN and a
 * "date" of "Growth" — so the columns are taken from the header row, with
 * the field count as the fallback when a header can't be read.
 */
const NARROW: Columns = { name: 3, plan: -1, option: -1, nav: 4, date: 5 };
const WIDE: Columns = { name: 3, plan: 4, option: 5, nav: 6, date: 7 };

function columnsFromHeader(parts: string[]): Columns | null {
  const find = (re: RegExp) => parts.findIndex((p) => re.test(p.trim()));
  const name = find(/^scheme name$/i);
  const nav = find(/^net asset value$/i);
  const date = find(/^date$/i);
  if (name < 0 || nav < 0 || date < 0) return null;
  return { name, plan: find(/^plan$/i), option: find(/^option$/i), nav, date };
}

/** AMFI's "04-Aug-2026". Anything else isn't a date we should show. */
const AMFI_DATE = /^\d{1,2}-[A-Za-z]{3}-\d{4}$/;

/**
 * NAVAll.txt line grammar:
 *   - header row naming the columns (contains ";" but a non-numeric first field)
 *   - "Open Ended Schemes(Debt Scheme - ...)" style category banners
 *   - bare fund-house lines ("Axis Mutual Fund") that scope the rows below
 *   - scheme rows, laid out as the header says
 */
export function parseNavAll(text: string): AmfiScheme[] {
  const schemes: AmfiScheme[] = [];
  let fundHouse = "";
  let header: Columns | null = null;
  const clean = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.includes(";")) {
      const parts = line.split(";");
      if (!/^\d+$/.test(parts[0])) {
        header = columnsFromHeader(parts) ?? header;
        continue;
      }
      if (parts.length < 6) continue;
      const cols = header ?? (parts.length >= 8 ? WIDE : NARROW);
      const base = clean(parts[cols.name]);
      if (!base) continue;
      // Fold plan and option back into the name, the way the narrow layout
      // carried them: without them "HDFC Flexi Cap Fund" is four different
      // schemes with four different NAVs and nothing to tell them apart.
      const name = [base, clean(parts[cols.plan]), clean(parts[cols.option])]
        .filter((p) => p && p !== "-")
        .join(" - ");
      const nav = parseFloat(parts[cols.nav]);
      const date = clean(parts[cols.date]);
      schemes.push({
        schemeCode: parts[0],
        name,
        fundHouse,
        nav: Number.isFinite(nav) && nav > 0 ? nav : null,
        navDate: AMFI_DATE.test(date) ? date : null,
        searchText: `${name} ${fundHouse}`.toLowerCase(),
      });
    } else if (!/Schemes\s*\(/i.test(line)) {
      fundHouse = line;
    }
  }
  return schemes;
}

function refresh(): Promise<AmfiScheme[]> {
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
        cache = {
          schemes,
          byCode: new Map(schemes.map((s) => [s.schemeCode, s])),
          fetchedAt: Date.now(),
        };
        lastFailureAt = 0;
        return schemes;
      } catch (e) {
        lastFailureAt = Date.now();
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

/** Every scheme in the feed. Throws when AMFI is unreachable and nothing is cached. */
export async function loadAmfiSchemes(): Promise<AmfiScheme[]> {
  if (cache) {
    // Stale-while-revalidate: a lapsed TTL kicks off a background refresh
    // but never blocks the caller on AMFI's latency.
    if (
      Date.now() - cache.fetchedAt >= CACHE_TTL_MS &&
      Date.now() - lastFailureAt >= FAILURE_COOLDOWN_MS
    ) {
      refresh().catch(() => {});
    }
    return cache.schemes;
  }
  // Cold cache: nothing to serve, so this request has to wait — but honour
  // the cooldown so repeated calls don't each hang for the timeout.
  if (Date.now() - lastFailureAt < FAILURE_COOLDOWN_MS) {
    throw new Error("AMFI fetch failed recently; cooling down");
  }
  return refresh();
}

/**
 * Latest NAV per scheme code. Codes the feed doesn't know, or reports
 * "N.A." for, are simply absent from the result. Throws under the same
 * conditions as `loadAmfiSchemes` — callers that only want a best-effort
 * valuation should catch and fall back to cost.
 */
export async function getFundNavs(codes: string[]): Promise<Record<string, FundNav>> {
  const wanted = [...new Set(codes.filter(Boolean))];
  if (wanted.length === 0) return {};
  await loadAmfiSchemes();
  const out: Record<string, FundNav> = {};
  for (const code of wanted) {
    const s = cache?.byCode.get(code);
    if (s && s.nav != null && s.nav > 0) out[code] = { nav: s.nav, navDate: s.navDate };
  }
  return out;
}
