import { atr, type Candle, historicalVol, median, rsi, sma } from "./indicators.ts";

export type CedearRow = {
  ticker: string;
  name: string;
  ratio: number;
  price: number; // ARS
  changePct: number | null;
  volume: number | null;
  relVolume: number | null; // volumen de hoy / promedio de 20 ruedas
  high52: number | null;
  low52: number | null;
  rangePos: number | null; // 0 = mínimo de 52 semanas, 1 = máximo
  usPrice: number | null;
  usChangePct: number | null;
  ccl: number | null; // CCL implícito: precio ARS × ratio / precio USD
  premium: number | null; // contra la mediana del CCL de la watchlist
  ratioSuspect: boolean;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
  vol20: number | null; // volatilidad anualizada
  atrPct: number | null;
  spark: number[];
  marketTime: number;
  historyFromUs?: boolean; // sin historial en BYMA: indicadores con la acción de EE.UU.
};

const ART_OFFSET = -3 * 3600;

export function artDay(unixSeconds: number): number {
  return Math.floor((unixSeconds + ART_OFFSET) / 86400);
}

// Pega el precio actual a la serie diaria: reemplaza la vela de hoy o la agrega.
export function withLivePrice(daily: Candle[], price: number, marketTime: number): Candle[] {
  if (!daily.length) return daily;
  const out = daily.slice();
  const last = out[out.length - 1];
  if (artDay(last.time) === artDay(marketTime)) {
    out[out.length - 1] = {
      ...last,
      close: price,
      high: Math.max(last.high, price),
      low: Math.min(last.low, price),
    };
  } else if (marketTime > last.time) {
    out.push({ time: marketTime, open: price, high: price, low: price, close: price, volume: 0 });
  }
  return out;
}

// Fracción de la rueda de BYMA (11 a 17) que ya pasó. Fuera de horario, 1.
// Supone volumen parejo en el día; arranca en 15 % para no inflar la apertura.
export function sessionElapsed(marketTime: number, now: number): number {
  if (artDay(marketTime) !== artDay(now)) return 1;
  const minutes = (((now + ART_OFFSET) % 86400) + 86400) % 86400 / 60;
  const f = (minutes - 11 * 60) / (6 * 60);
  return Math.min(1, Math.max(0.15, f));
}

type Inputs = {
  ticker: string;
  ratio: number;
  local: {
    name: string;
    price: number;
    previousClose: number | null;
    dayVolume: number | null;
    high52: number | null;
    low52: number | null;
    marketTime: number;
    intraday: Candle[];
  };
  daily: Candle[];
  us: { price: number; previousClose: number | null } | null;
};

export function buildRow({ ticker, ratio, local, daily, us }: Inputs, now = Date.now() / 1000): CedearRow {
  const series = withLivePrice(daily, local.price, local.marketTime);
  const closes = series.map((c) => c.close);
  const today = artDay(local.marketTime);
  const pastVolumes = series.filter((c) => artDay(c.time) < today).slice(-20).map((c) => c.volume);
  const avgVol = pastVolumes.length ? pastVolumes.reduce((a, b) => a + b, 0) / pastVolumes.length : 0;
  const volume = local.dayVolume; // de la última rueda, aunque hoy no haya operado
  const elapsed = sessionElapsed(local.marketTime, now);
  const atrValue = atr(series);
  const { high52, low52 } = local;

  return {
    ticker,
    name: local.name,
    ratio,
    price: local.price,
    changePct: local.previousClose ? local.price / local.previousClose - 1 : null,
    volume,
    // Con la rueda en curso se compara contra lo que debería llevar a esta hora.
    relVolume: avgVol > 0 && volume != null ? volume / (avgVol * elapsed) : null,
    high52,
    low52,
    rangePos:
      high52 != null && low52 != null && high52 > low52
        ? Math.min(1, Math.max(0, (local.price - low52) / (high52 - low52)))
        : null,
    usPrice: us?.price ?? null,
    usChangePct: us?.previousClose ? us.price / us.previousClose - 1 : null,
    ccl: us?.price ? (local.price * ratio) / us.price : null,
    premium: null,
    ratioSuspect: false,
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    rsi14: rsi(closes),
    vol20: historicalVol(closes),
    atrPct: atrValue != null ? atrValue / local.price : null,
    spark: local.intraday.map((c) => c.close),
    marketTime: local.marketTime,
  };
}

// Compara el CCL implícito de cada papel con la mediana de la watchlist.
// Un desvío mayor al 15 % casi siempre es un ratio desactualizado, no un precio real.
export function applyPremiums(rows: CedearRow[]): { rows: CedearRow[]; cclMedian: number | null } {
  const cclMedian = median(rows.map((r) => r.ccl ?? NaN));
  return {
    cclMedian,
    rows: rows.map((r) => {
      if (r.ccl == null || cclMedian == null) return r;
      const premium = r.ccl / cclMedian - 1;
      return { ...r, premium, ratioSuspect: Math.abs(premium) > 0.15 };
    }),
  };
}
