import type { Candle } from "./indicators";

// Yahoo Finance: BYMA (sufijo .BA) llega con unos 20 minutos de demora;
// NYSE y NASDAQ, en tiempo casi real durante la rueda.

export type YahooChart = {
  symbol: string;
  name: string;
  currency: string;
  price: number;
  previousClose: number | null;
  marketTime: number;
  dayVolume: number | null;
  high52: number | null;
  low52: number | null;
  candles: Candle[];
};

const cache = new Map<string, { at: number; data: Promise<YahooChart | null> }>();

export function getChart(symbol: string, range: string, interval: string, ttlMs: number) {
  const key = `${symbol}|${range}|${interval}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const data = fetchChart(symbol, range, interval).catch(() => null);
  cache.set(key, { at: Date.now(), data });
  // Si falló, que el próximo pedido vuelva a intentar.
  data.then((d) => d === null && cache.delete(key));
  return data;
}

async function fetchChart(symbol: string, range: string, interval: string): Promise<YahooChart | null> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${range}&interval=${interval}&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (ric-terminal)" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  if (!r?.meta?.regularMarketPrice) return null;
  const m = r.meta;
  const q = r.indicators?.quote?.[0] ?? {};
  const ts: number[] = r.timestamp ?? [];
  const candles: Candle[] = [];
  ts.forEach((t, i) => {
    const c = q.close?.[i];
    if (c == null) return;
    candles.push({
      time: t,
      open: q.open?.[i] ?? c,
      high: q.high?.[i] ?? c,
      low: q.low?.[i] ?? c,
      close: c,
      volume: q.volume?.[i] ?? 0,
    });
  });
  return {
    symbol,
    name: m.longName ?? m.shortName ?? symbol,
    currency: m.currency ?? "",
    price: m.regularMarketPrice,
    previousClose: m.previousClose ?? m.chartPreviousClose ?? null,
    marketTime: m.regularMarketTime ?? 0,
    dayVolume: m.regularMarketVolume ?? null,
    high52: m.fiftyTwoWeekHigh ?? null,
    low52: m.fiftyTwoWeekLow ?? null,
    candles,
  };
}
