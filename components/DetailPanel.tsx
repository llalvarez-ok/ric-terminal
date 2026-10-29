"use client";
import { useEffect, useMemo, useState } from "react";
import { binanceKlines, type Frame, FRAMES, useBinanceCandles, useYahooCandles } from "@/hooks/useCandles";
import type { CryptoRow } from "@/hooks/useCrypto";
import type { Alert } from "@/hooks/useAlerts";
import { num, parseAmount, pct, price, tone } from "@/lib/format";
import { atr, historicalVol, rsi, sma } from "@/lib/indicators";
import { insights, type Stats } from "@/lib/insights";
import type { CedearRow } from "@/lib/metrics";
import { usSymbol } from "@/lib/ratios";
import { PriceChart } from "./PriceChart";

export type Selection = { kind: "cedear" | "crypto"; ticker: string };

type Props = {
  selection: Selection | null;
  cedear: CedearRow | null;
  crypto: CryptoRow | null;
  usdCripto: number | null;
  frame: Frame;
  onFrame: (f: Frame) => void;
  onAddAlert: (a: Omit<Alert, "id" | "createdAt" | "triggeredAt">) => void;
};

export function DetailPanel({ selection, cedear, crypto, usdCripto, frame, onFrame, onAddAlert }: Props) {
  const [market, setMarket] = useState<"ARS" | "USD">("ARS");
  const isCedear = selection?.kind === "cedear";
  const yahooSymbol = isCedear && selection ? (market === "ARS" ? `${selection.ticker}.BA` : usSymbol(selection.ticker)) : null;
  const yahoo = useYahooCandles(yahooSymbol, frame);
  const binance = useBinanceCandles(selection?.kind === "crypto" ? `${selection.ticker}USDT` : null, frame);
  const candles = isCedear ? yahoo.candles : binance.candles;
  const chartError = isCedear ? yahoo.error : binance.error;
  const cryptoStats = useCryptoDailyStats(selection?.kind === "crypto" ? selection.ticker : null, crypto?.price ?? null);

  if (!selection) return <div className="panel empty">Elegí un papel de la lista.</div>;

  const stats: Stats | null = isCedear
    ? cedear && {
        price: cedear.price,
        changePct: cedear.changePct,
        relVolume: cedear.relVolume,
        high: cedear.high52,
        low: cedear.low52,
        rangeLabel: "52 semanas",
        sma20: cedear.sma20,
        sma50: cedear.sma50,
        sma200: cedear.sma200,
        rsi14: cedear.rsi14,
        vol20: cedear.vol20,
        atrPct: cedear.atrPct,
        premium: cedear.premium,
        ratioSuspect: cedear.ratioSuspect,
      }
    : crypto && cryptoStats && { ...cryptoStats, price: crypto.price, changePct: crypto.changePct };

  const current = isCedear ? cedear?.price : crypto?.price;
  const change = isCedear ? cedear?.changePct : crypto?.changePct;
  const precision = current != null && current < 1 ? 6 : current != null && current < 10 ? 4 : 2;

  return (
    <div className="panel detail">
      <div className="detail-head">
        <div>
          <div className="detail-ticker">{selection.ticker}</div>
          <div className="muted small">
            {isCedear ? `${cedear?.name ?? ""} · CEDEAR ${cedear?.ratio ? `${num(cedear.ratio, cedear.ratio % 1 ? 2 : 0)}:1` : "sin ratio"}` : `${selection.ticker}/USDT · Binance`}
          </div>
        </div>
        <div className="detail-price">
          <div className="big">{price(current)}</div>
          <div className={tone(change)}>
            {pct(change)} <span className="muted small">{isCedear ? "hoy" : "24 h"}</span>
          </div>
        </div>
      </div>

      <div className="toolbar">
        {FRAMES.map((f, i) => (
          <button key={f} className={f === frame ? "on" : ""} onClick={() => onFrame(f)} title={`Tecla ${i + 1}`}>
            {f}
          </button>
        ))}
        {isCedear && (
          <span className="toolbar-right">
            {(["ARS", "USD"] as const).map((m) => (
              <button key={m} className={m === market ? "on" : ""} onClick={() => setMarket(m)}>
                {m === "ARS" ? "BYMA (ARS)" : "EE.UU. (USD)"}
              </button>
            ))}
          </span>
        )}
      </div>

      <div className="chart-wrap">
        {chartError && !candles.length ? <div className="chart-msg">No se pudo cargar el gráfico ({chartError}).</div> : null}
        {isCedear && market === "ARS" && frame !== "1D" && candles.length > 0 && candles.length < 5 ? (
          <div className="chart-msg">
            <span>
              Yahoo no tiene el historial de {selection.ticker} en BYMA.{" "}
              <button className="link" onClick={() => setMarket("USD")}>
                Ver en EE.UU.
              </button>
            </span>
          </div>
        ) : null}
        <PriceChart key={`${selection.kind}:${selection.ticker}`} candles={candles} showSma={frame === "6M" || frame === "1A"} precision={precision} />
      </div>
      <div className="legend muted small">
        {frame === "6M" || frame === "1A" ? (
          <>
            <span className="sw sw-20" /> Media 20 <span className="sw sw-50" /> Media 50 ·{" "}
          </>
        ) : null}
        {isCedear ? (market === "ARS" ? "BYMA con unos 20 min de demora" : "Mercado de EE.UU.") : "En vivo"} · hora de Buenos Aires
      </div>

      {stats ? <StatsGrid s={stats} cedear={isCedear ? cedear : null} usdCripto={isCedear ? null : usdCripto} /> : <div className="muted small pad">Calculando…</div>}

      {isCedear && cedear?.historyFromUs ? (
        <div className="notice">Sin historial en BYMA: medias, RSI y volatilidad calculados con la acción en EE.UU.</div>
      ) : null}

      {stats ? (
        <ul className="insights">
          {insights({ ...stats, unit: isCedear ? "ruedas" : "días" }).map((it) => (
            <li key={it.text} className={`ins-${it.tone}`}>
              {it.text}
            </li>
          ))}
        </ul>
      ) : null}

      {current != null ? <AlertForm key={selection.ticker} selection={selection} current={current} onAdd={onAddAlert} /> : null}
    </div>
  );
}

function StatsGrid({ s, cedear, usdCripto }: { s: Stats; cedear: CedearRow | null; usdCripto: number | null }) {
  const cell = (label: string, value: string, cls = "", title?: string) => (
    <div className="stat" title={title}>
      <span className="muted">{label}</span>
      <span className={cls}>{value}</span>
    </div>
  );
  const vsSma = (m: number | null) => (m == null ? "—" : `${price(m)} (${pct(s.price / m - 1, 1)})`);
  return (
    <div className="stats">
      {cedear && (
        <>
          {cell("Precio EE.UU.", `${price(cedear.usPrice)} USD`)}
          {cell("Var. EE.UU.", pct(cedear.usChangePct), tone(cedear.usChangePct))}
          {cell("CCL implícito", num(cedear.ccl, 2), cedear.ratioSuspect ? "warn" : "", "Precio ARS × ratio ÷ precio USD")}
          {cell("Prem. vs. lista", pct(cedear.premium, 2), "", "Contra la mediana del CCL implícito de tu lista")}
          {cell("USD por CEDEAR", cedear.ccl ? price(cedear.price / cedear.ccl) : "—", "", "Precio ARS ÷ CCL implícito")}
        </>
      )}
      {usdCripto != null && cell("En ARS (cripto)", `${price(s.price * usdCripto)}`, "", "Al dólar cripto")}
      {cell(`Máx. ${s.rangeLabel === "52 semanas" ? "52 sem." : s.rangeLabel}`, price(s.high))}
      {cell(`Mín. ${s.rangeLabel === "52 semanas" ? "52 sem." : s.rangeLabel}`, price(s.low))}
      {cell("Media 20", vsSma(s.sma20))}
      {cell("Media 50", vsSma(s.sma50))}
      {cell("Media 200", vsSma(s.sma200))}
      {cell("RSI 14", num(s.rsi14, 0), s.rsi14 != null && (s.rsi14 >= 70 || s.rsi14 <= 30) ? "hot" : "")}
      {cell("Volatilidad 20", pct(s.vol20, 1, false), "", "Desvío de los retornos diarios, anualizado")}
      {cell("ATR 14", pct(s.atrPct, 2, false), "", "Rango promedio diario, en % del precio")}
      {cell("Vol. relativo", s.relVolume != null ? `${num(s.relVolume, 1)}x` : "—")}
    </div>
  );
}

// Para cripto, las medias, el RSI y la volatilidad salen de velas diarias.
function useCryptoDailyStats(ticker: string | null, live: number | null) {
  const [daily, setDaily] = useState<Awaited<ReturnType<typeof binanceKlines>> | null>(null);
  useEffect(() => {
    setDaily(null);
    if (!ticker) return;
    let cancelled = false;
    binanceKlines(`${ticker}USDT`, "1d", 365)
      .then((c) => !cancelled && setDaily(c))
      .catch(() => !cancelled && setDaily([]));
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  return useMemo(() => {
    if (!daily?.length || live == null) return null;
    const candles = [...daily.slice(0, -1), { ...daily[daily.length - 1], close: live }];
    const closes = candles.map((c) => c.close);
    const past = candles.slice(-21, -1).map((c) => c.volume);
    const avg = past.reduce((a, b) => a + b, 0) / (past.length || 1);
    const year = candles.slice(-365);
    const a = atr(candles);
    return {
      relVolume: avg ? candles[candles.length - 1].volume / avg : null,
      high: Math.max(...year.map((c) => c.high)),
      low: Math.min(...year.map((c) => c.low)),
      rangeLabel: "un año",
      sma20: sma(closes, 20),
      sma50: sma(closes, 50),
      sma200: sma(closes, 200),
      rsi14: rsi(closes),
      vol20: historicalVol(closes, 20, 365),
      atrPct: a != null ? a / live : null,
    };
  }, [daily, live]);
}

function AlertForm({ selection, current, onAdd }: { selection: Selection; current: number; onAdd: Props["onAddAlert"] }) {
  const [value, setValue] = useState("");
  const target = parseAmount(value);
  const valid = value.trim() !== "" && Number.isFinite(target) && target > 0;
  const op = target >= current ? ">=" : "<=";
  return (
    <form
      className="alert-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onAdd({ kind: selection.kind, ticker: selection.ticker, op, target });
        setValue("");
      }}
    >
      <span className="muted small">Alerta de precio</span>
      <input
        id="alert-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={price(current)}
        inputMode="decimal"
      />
      <button type="submit" disabled={!valid}>
        {valid ? (op === ">=" ? "Avisar si sube a" : "Avisar si baja a") : "Agregar"}
      </button>
    </form>
  );
}

