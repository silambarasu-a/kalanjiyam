import { NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
  high52w: number;
  low52w: number;
  exchange: string;
  currency: string;
}

export async function GET(request: Request) {
  try {
    await requireWorkspace("investments", "read");

    const { searchParams } = new URL(request.url);
    const symbols = searchParams.get("symbols");
    if (!symbols) {
      return NextResponse.json({ error: "symbols parameter required" }, { status: 400 });
    }

    const sanitized = symbols.replace(/[^A-Z0-9.,^-]/gi, "").toUpperCase();
    if (!sanitized) {
      return NextResponse.json({ error: "Invalid symbols" }, { status: 400 });
    }

    const symbolList = sanitized.split(",").filter(Boolean);

    const results = await Promise.all(
      symbolList.map(async (sym) => {
        try {
          return await yf.quote(sym);
        } catch {
          return null;
        }
      })
    );

    const quotes: StockQuote[] = results
      .filter((q): q is NonNullable<typeof q> => q != null)
      .map((q) => ({
        symbol: q.symbol,
        name: q.longName ?? q.shortName ?? q.symbol,
        price: q.regularMarketPrice ?? 0,
        change: q.regularMarketChange ?? 0,
        changePercent: q.regularMarketChangePercent ?? 0,
        previousClose: q.regularMarketPreviousClose ?? 0,
        high52w: q.fiftyTwoWeekHigh ?? 0,
        low52w: q.fiftyTwoWeekLow ?? 0,
        exchange: q.exchange ?? "",
        currency: q.currency ?? "INR",
      }));

    return NextResponse.json(quotes);
  } catch (e) {
    if (e instanceof WorkspaceAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Market data unavailable" }, { status: 502 });
  }
}
