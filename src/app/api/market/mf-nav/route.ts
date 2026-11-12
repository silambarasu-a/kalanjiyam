import { NextResponse } from "next/server";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { getFundNavs, type FundNav } from "@/lib/amfi";

/** `{ [amfiSchemeCode]: { nav, navDate } }` — codes with no NAV are absent. */
export type MfNavResponse = Record<string, FundNav>;

/**
 * Latest AMFI NAV for a set of scheme codes: `?codes=120334,101762`.
 * Used to mark mutual-fund and SIP holdings to market.
 */
export async function GET(request: Request) {
  try {
    await requireWorkspace("investments", "read");
    const { searchParams } = new URL(request.url);
    const codes = (searchParams.get("codes") ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter((c) => /^\d{1,10}$/.test(c))
      .slice(0, 200);
    return NextResponse.json(await getFundNavs(codes));
  } catch (e) {
    if (e instanceof WorkspaceAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[mf-nav]", e);
    return NextResponse.json({ error: "Couldn't load NAVs from AMFI" }, { status: 502 });
  }
}
