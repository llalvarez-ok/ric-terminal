import { NextResponse } from "next/server";
import { applyPremiums, buildRow, type CedearRow } from "@/lib/metrics";
import { RATIOS, usSymbol } from "@/lib/ratios";
import { getChart } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

const TICKER = /^[A-Z0-9.]{1,10}$/;

// GET /api/cedears?symbols=AAPL,MELI&ratios=XYZ:4
// `ratios` permite pasar ratios para tickers que no están en la tabla.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const extraRatios = Object.fromEntries(
    (params.get("ratios") ?? "")
      .split(",")
      .map((s) => s.split(":"))
      .filter(([t, r]) => TICKER.test(t ?? "") && Number(r) > 0)
      .map(([t, r]) => [t, Number(r)]),
  );
  const tickers = (params.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => TICKER.test(s))
    .slice(0, 40);

  const missing: string[] = [];
  const rows = await Promise.all(
    tickers.map(async (ticker): Promise<CedearRow | null> => {
      const ratio = extraRatios[ticker] ?? RATIOS[ticker];
      const [local, daily, us] = await Promise.all([
        getChart(`${ticker}.BA`, "1d", "5m", 60_000),
        getChart(`${ticker}.BA`, "1y", "1d", 15 * 60_000),
        ratio ? getChart(usSymbol(ticker), "1d", "5m", 60_000) : Promise.resolve(null),
      ]);
      if (!local) {
        missing.push(ticker);
        return null;
      }
      // Yahoo no tiene historial de algunos CEDEARs (por ejemplo META.BA).
      // En ese caso las medias y el RSI salen de la acción en EE.UU.,
      // llevada a pesos con el tipo de cambio implícito de hoy.
      let history = daily?.candles ?? [];
      let historyFromUs = false;
      if (history.length < 30 && us) {
        const usDaily = await getChart(usSymbol(ticker), "1y", "1d", 15 * 60_000);
        if (usDaily && usDaily.candles.length >= 30) {
          const k = local.price / us.price;
          history = usDaily.candles.map((c) => ({
            time: c.time,
            open: c.open * k,
            high: c.high * k,
            low: c.low * k,
            close: c.close * k,
            volume: 0,
          }));
          historyFromUs = true;
        }
      }
      return {
        ...buildRow({
          ticker,
          ratio: ratio ?? 0,
          local: { ...local, intraday: local.candles },
          daily: history,
          us: ratio && us ? { price: us.price, previousClose: us.previousClose } : null,
        }),
        historyFromUs,
      };
    }),
  );

  const { rows: withPremium, cclMedian } = applyPremiums(rows.filter((r): r is CedearRow => r !== null));
  return NextResponse.json({ rows: withPremium, cclMedian, missing, fetchedAt: Date.now() });
}
