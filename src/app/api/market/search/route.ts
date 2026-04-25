import { NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  exchangeDisplay: string;
  type: string;
}

const EXCHANGE_MAP: Record<string, string> = {
  NSI: "NSE",
  BOM: "BSE",
  BSE: "BSE",
  NMS: "NASDAQ",
  NGM: "NASDAQ",
  NIM: "NASDAQ",
  NYQ: "NYSE",
  PCX: "NYSE",
  ASE: "NYSE",
};

export async function GET(request: Request) {
  try {
    await requireWorkspace("investments", "read");

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim();
    if (!q || q.length < 1) {
      return NextResponse.json([]);
    }

    const safe = q.replace(/[^A-Za-z0-9 .\-^]/g, "");
    if (!safe) return NextResponse.json([]);

    const searchResult = await yf.search(safe, { quotesCount: 8, newsCount: 0 });
    const quotes = searchResult.quotes ?? [];

    const results: SymbolSearchResult[] = quotes
      .filter((item) => {
        const qt = "quoteType" in item ? item.quoteType : undefined;
        return qt === "EQUITY" || qt === "ETF";
      })
      .slice(0, 7)
      .map((item) => {
        const exchange = "exchange" in item ? (item.exchange as string) : "";
        return {
          symbol: item.symbol as string,
          name:
            ("longname" in item ? (item.longname as string) : undefined) ??
            ("shortname" in item ? (item.shortname as string) : undefined) ??
            (item.symbol as string),
          exchange: EXCHANGE_MAP[exchange] ?? exchange ?? "",
          exchangeDisplay: EXCHANGE_MAP[exchange] ?? exchange ?? "",
          type: "quoteType" in item ? (item.quoteType as string) : "",
        };
      });

    return NextResponse.json(results);
  } catch (e) {
    if (e instanceof WorkspaceAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json([]);
  }
}
