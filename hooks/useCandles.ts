"use client";
import { useEffect, useState } from "react";
import type { Candle } from "@/lib/indicators";
import { BINANCE_REST } from "./useCrypto";
import { usePolling } from "./usePolling";

export const FRAMES = ["1D", "5D", "1M", "6M", "1A", "5A"] as const;
export type Frame = (typeof FRAMES)[number];

// Velas de Yahoo vía /api/history (CEDEARs en ARS o la acción en USD).
export function useYahooCandles(symbol: string | null, frame: Frame) {
  const every = frame === "1D" || frame === "5D" ? 60_000 : 5 * 60_000;
  const { data, error } = usePolling<{ candles: Candle[] }>(
    symbol ? `/api/history?symbol=${encodeURIComponent(symbol)}&frame=${frame}` : null,
    every,
  );
  return { candles: data?.candles ?? [], error };
}

const BINANCE_FRAMES: Record<Frame, { interval: string; limit: number }> = {
  "1D": { interval: "5m", limit: 288 },
  "5D": { interval: "15m", limit: 480 },
  "1M": { interval: "1h", limit: 720 },
  "6M": { interval: "1d", limit: 180 },
  "1A": { interval: "1d", limit: 365 },
  "5A": { interval: "1w", limit: 260 },
};

type Kline = (string | number)[];

const toCandle = (k: Kline): Candle => ({
  time: Math.floor(Number(k[0]) / 1000),
  open: Number(k[1]),
  high: Number(k[2]),
  low: Number(k[3]),
  close: Number(k[4]),
  volume: Number(k[7]), // volumen en USDT
});

export async function binanceKlines(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  const res = await fetch(`${BINANCE_REST}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  return ((await res.json()) as Kline[]).map(toCandle);
}

// Velas de Binance con la última actualizándose en vivo.
export function useBinanceCandles(symbol: string | null, frame: Frame) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) return;
    const { interval, limit } = BINANCE_FRAMES[frame];
    let cancelled = false;
    let ws: WebSocket | null = null;
    setCandles([]);

    binanceKlines(symbol, interval, limit)
      .then((c) => {
        if (cancelled) return;
        setCandles(c);
        setError(null);
        ws = new WebSocket(`wss://data-stream.binance.vision/ws/${symbol.toLowerCase()}@kline_${interval}`);
        ws.onmessage = (e) => {
          const k = JSON.parse(e.data)?.k;
          if (!k) return;
          const live: Candle = {
            time: Math.floor(k.t / 1000),
            open: Number(k.o),
            high: Number(k.h),
            low: Number(k.l),
            close: Number(k.c),
            volume: Number(k.q),
          };
          setCandles((prev) => {
            if (!prev.length) return prev;
            const last = prev[prev.length - 1];
            if (live.time === last.time) return [...prev.slice(0, -1), live];
            if (live.time > last.time) return [...prev, live];
            return prev;
          });
        };
      })
      .catch((e) => !cancelled && setError(e.message));

    return () => {
      cancelled = true;
      ws?.close();
    };
  }, [symbol, frame]);

  return { candles, error };
}
