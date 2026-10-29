import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAmount, pct } from "../lib/format.ts";
import { atr, type Candle, historicalVol, median, rsi, sma } from "../lib/indicators.ts";
import { insights } from "../lib/insights.ts";
import { applyPremiums, buildRow, withLivePrice } from "../lib/metrics.ts";
import { marketStatuses } from "../lib/markets.ts";
import { RATIOS } from "../lib/ratios.ts";

const day = 86400;
const candles = (closes: number[], start = 1_790_000_000): Candle[] =>
  closes.map((c, i) => ({ time: start + i * day, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 100 }));

test("sma y mediana", () => {
  assert.equal(sma([1, 2, 3, 4], 2), 3.5);
  assert.equal(sma([1], 2), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

test("rsi: 100 si solo sube, 0 si solo baja", () => {
  const ups = Array.from({ length: 30 }, (_, i) => 100 + i);
  assert.equal(rsi(ups), 100);
  assert.equal(Math.round(rsi(ups.slice().reverse())!), 0);
  assert.equal(rsi([1, 2, 3]), null);
});

test("volatilidad nula con retornos constantes", () => {
  const steady = Array.from({ length: 30 }, (_, i) => 100 * 1.01 ** i);
  assert.ok(historicalVol(steady)! < 1e-9);
});

test("atr de velas con rango del 2 %", () => {
  const a = atr(candles(Array(30).fill(100)))!;
  assert.ok(Math.abs(a - 2) < 1e-9);
});

test("ratios: enteros y fraccionarios", () => {
  assert.equal(RATIOS.AAPL, 20);
  assert.equal(RATIOS.MELI, 120);
  assert.equal(RATIOS.SAN, 0.25);
});

test("precio en vivo reemplaza la vela del mismo día o agrega una", () => {
  const d = candles([10, 11]);
  const same = withLivePrice(d, 12, d[1].time + 3600);
  assert.equal(same.length, 2);
  assert.equal(same[1].close, 12);
  assert.equal(same[1].high, 12);
  const next = withLivePrice(d, 13, d[1].time + day);
  assert.equal(next.length, 3);
});

test("CCL implícito y premio contra la mediana", () => {
  const base = { name: "x", previousClose: 100, dayVolume: 200, high52: 120, low52: 80, intraday: [] };
  const mk = (ticker: string, ars: number, ratio: number, usd: number) =>
    buildRow({
      ticker,
      ratio,
      local: { ...base, price: ars, marketTime: 1_790_000_000 + 40 * day },
      daily: candles(Array(40).fill(ars)),
      us: { price: usd, previousClose: usd },
    });
  const rows = [mk("A", 1650, 10, 10), mk("B", 1700, 10, 10), mk("C", 1600, 10, 10), mk("D", 3300, 10, 10)];
  assert.equal(rows[0].ccl, 1650);
  assert.equal(rows[0].relVolume, 2, "rueda terminada: volumen contra el promedio");
  const { rows: out, cclMedian } = applyPremiums(rows);
  assert.equal(cclMedian, 1675);
  assert.ok(out[2].premium! < 0 && !out[2].ratioSuspect);
  assert.ok(out[3].ratioSuspect, "un CCL del doble indica ratio desactualizado");
});

test("lectura rápida sin recomendaciones de compra o venta", () => {
  const list = insights({
    price: 100, changePct: 0.01, relVolume: 2, high: 101, low: 50, rangeLabel: "52 semanas",
    sma20: 95, sma50: 90, sma200: 80, rsi14: 75, vol20: 0.3, atrPct: 0.02, premium: -0.03,
  });
  const text = list.map((i) => i.text).join(" ");
  assert.match(text, /más barato/);
  assert.match(text, /máximo de 52 semanas/);
  assert.match(text, /sobrecompra/);
  assert.doesNotMatch(text, /\b(comprá|vendé|comprar|vender)\b/i);
});

test("formato argentino", () => {
  assert.equal(pct(0.0123), "+1,23%");
  assert.equal(parseAmount("1.234,5"), 1234.5);
  assert.equal(parseAmount("81.500"), 81500);
  assert.equal(parseAmount("0.5"), 0.5);
  assert.equal(parseAmount("28900"), 28900);
});

test("ruedas: BYMA abierta un miércoles a las 12 de Buenos Aires", () => {
  const wed = new Date("2026-10-28T15:00:00Z"); // 12:00 ART, 11:00 NY
  const [byma, nyse] = marketStatuses(wed);
  assert.equal(byma.open, true);
  assert.equal(nyse.open, true);
  const sat = new Date("2026-10-31T15:00:00Z");
  assert.equal(marketStatuses(sat)[0].open, false);
});

test("volumen relativo a mitad de rueda", async () => {
  const { sessionElapsed } = await import("../lib/metrics.ts");
  const t = Date.parse("2026-10-28T17:00:00Z") / 1000; // 14:00 ART, mitad de la rueda
  assert.equal(sessionElapsed(t, t), 0.5);
  assert.equal(sessionElapsed(t - 86400, t), 1);
});
