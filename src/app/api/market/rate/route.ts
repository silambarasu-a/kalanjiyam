import { NextResponse } from "next/server";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

export async function GET(request: Request) {
  try {
    await requireWorkspace("investments", "read");

    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from") || "USD";
    const to = searchParams.get("to") || "INR";
    const date = searchParams.get("date");

    // `fresh=1` skips the fetch cache. The cached path is
    // stale-while-revalidate: after a quiet spell the first caller gets
    // whatever rate was last stored — days old, potentially — while the
    // refresh happens behind it. Fine for valuing a portfolio; not for the
    // default on a currency conversion, where the number is about to be
    // multiplied into real money.
    const fresh = searchParams.get("fresh") === "1";

    const endpoint = date || "latest";
    const res = await fetch(
      `https://api.frankfurter.app/${endpoint}?from=${from}&to=${to}`,
      fresh ? { cache: "no-store" } : { next: { revalidate: date ? 86400 : 3600 } },
    );

    if (!res.ok) {
      return NextResponse.json({ error: "Failed to fetch exchange rate" }, { status: 502 });
    }

    const json = await res.json();
    const rate: number = json?.rates?.[to] ?? 0;

    return NextResponse.json({
      rate,
      from,
      to,
      date: json.date ?? new Date().toISOString().slice(0, 10),
      updatedAt: json.date ?? new Date().toISOString().slice(0, 10),
    });
  } catch (e) {
    if (e instanceof WorkspaceAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Exchange rate unavailable" }, { status: 502 });
  }
}
