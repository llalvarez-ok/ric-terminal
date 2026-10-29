import { NextResponse } from "next/server";
import { getChart } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

// Rangos e intervalos que acepta Yahoo y que usa el gráfico.
const FRAMES: Record<string, { range: string; interval: string; ttl: number }> = {
  "1D": { range: "1d", interval: "5m", ttl: 60_000 },
  "5D": { range: "5d", interval: "15m", ttl: 120_000 },
  "1M": { range: "1mo", interval: "1h", ttl: 300_000 },
  "6M": { range: "6mo", interval: "1d", ttl: 900_000 },
  "1A": { range: "1y", interval: "1d", ttl: 900_000 },
  "5A": { range: "5y", interval: "1wk", ttl: 3_600_000 },
};

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const symbol = (params.get("symbol") ?? "").toUpperCase();
  const frame = FRAMES[params.get("frame") ?? "6M"];
  if (!/^[A-Z0-9.\-]{1,14}$/.test(symbol) || !frame) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }
  const chart = await getChart(symbol, frame.range, frame.interval, frame.ttl);
  if (!chart) return NextResponse.json({ error: "Sin datos" }, { status: 502 });
  return NextResponse.json({ candles: chart.candles, currency: chart.currency });
}
