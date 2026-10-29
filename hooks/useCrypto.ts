"use client";
import { useEffect, useRef, useState } from "react";

// Binance, endpoints públicos solo de datos de mercado (data-api y data-stream
// .binance.vision): no requieren cuenta y funcionan desde cualquier país.
export const BINANCE_REST = "https://data-api.binance.vision/api/v3";
const BINANCE_WS = "wss://data-stream.binance.vision/stream";

export type CryptoRow = {
  ticker: string;
  symbol: string; // BTCUSDT
  price: number;
  open: number; // hace 24 h
  changePct: number;
  high: number;
  low: number;
  quoteVolume: number; // en USDT, últimas 24 h
  spark: number[]; // cierres por hora, últimas 24 h
  updatedAt: number;
};

type MiniTicker = { s: string; c: string; o: string; h: string; l: string; q: string; E: number };

function fromMini(t: MiniTicker, prev?: CryptoRow): Partial<CryptoRow> {
  const price = Number(t.c);
  const open = Number(t.o);
  const spark = prev?.spark.length ? [...prev.spark.slice(0, -1), price] : [];
  return {
    price,
    open,
    changePct: open ? price / open - 1 : 0,
    high: Number(t.h),
    low: Number(t.l),
    quoteVolume: Number(t.q),
    spark,
    updatedAt: t.E,
  };
}

async function loadSnapshot(tickers: string[]): Promise<Record<string, CryptoRow>> {
  const symbols = tickers.map((t) => `${t}USDT`);
  const res = await fetch(`${BINANCE_REST}/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`);
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  const list: { symbol: string; lastPrice: string; openPrice: string; highPrice: string; lowPrice: string; quoteVolume: string; closeTime: number }[] =
    await res.json();
  const sparks = await Promise.all(
    symbols.map((s) =>
      fetch(`${BINANCE_REST}/klines?symbol=${s}&interval=1h&limit=24`)
        .then((r) => (r.ok ? r.json() : []))
        .then((k: unknown[][]) => k.map((c) => Number(c[4])))
        .catch(() => [] as number[]),
    ),
  );
  const out: Record<string, CryptoRow> = {};
  for (const t of list) {
    const ticker = t.symbol.replace(/USDT$/, "");
    const price = Number(t.lastPrice);
    const open = Number(t.openPrice);
    out[ticker] = {
      ticker,
      symbol: t.symbol,
      price,
      open,
      changePct: open ? price / open - 1 : 0,
      high: Number(t.highPrice),
      low: Number(t.lowPrice),
      quoteVolume: Number(t.quoteVolume),
      spark: sparks[symbols.indexOf(t.symbol)] ?? [],
      updatedAt: t.closeTime,
    };
  }
  return out;
}

export function useCrypto(tickers: string[]) {
  const [rows, setRows] = useState<Record<string, CryptoRow>>({});
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = tickers.join(",");
  const pending = useRef<Record<string, MiniTicker>>({});

  // Foto inicial y velas por hora; se refresca cada 10 minutos.
  useEffect(() => {
    if (!tickers.length) return;
    let cancelled = false;
    const load = () =>
      loadSnapshot(tickers)
        .then((snap) => {
          if (cancelled) return;
          setRows(snap);
          setError(null);
        })
        .catch((e) => !cancelled && setError(e.message));
    load();
    const id = setInterval(load, 10 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Precio en vivo por WebSocket, con reconexión.
  useEffect(() => {
    if (!tickers.length) return;
    let ws: WebSocket | null = null;
    let retry = 0;
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;
    const streams = tickers.map((t) => `${t.toLowerCase()}usdt@miniTicker`).join("/");

    const connect = () => {
      ws = new WebSocket(`${BINANCE_WS}?streams=${streams}`);
      ws.onopen = () => {
        retry = 0;
        setLive(true);
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg?.data?.s) pending.current[msg.data.s] = msg.data;
      };
      ws.onclose = () => {
        setLive(false);
        if (closed) return;
        timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++));
      };
      ws.onerror = () => ws?.close();
    };
    connect();

    // Se aplican los mensajes una vez por segundo para no redibujar de más.
    const flush = setInterval(() => {
      const batch = pending.current;
      pending.current = {};
      const items = Object.values(batch);
      if (!items.length) return;
      setRows((prev) => {
        const next = { ...prev };
        for (const t of items) {
          const ticker = t.s.replace(/USDT$/, "");
          const old = next[ticker];
          if (!old) continue;
          next[ticker] = { ...old, ...fromMini(t, old) };
        }
        return next;
      });
    }, 1000);

    return () => {
      closed = true;
      clearTimeout(timer);
      clearInterval(flush);
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { rows, live, error };
}

// Comprueba que exista el par contra USDT antes de agregarlo a la lista.
export async function cryptoExists(ticker: string): Promise<boolean> {
  try {
    const res = await fetch(`${BINANCE_REST}/ticker/price?symbol=${ticker}USDT`);
    return res.ok;
  } catch {
    return false;
  }
}
