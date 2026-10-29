"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAlerts } from "@/hooks/useAlerts";
import { type Frame, FRAMES } from "@/hooks/useCandles";
import { cryptoExists, useCrypto } from "@/hooks/useCrypto";
import { usePolling } from "@/hooks/usePolling";
import { useStored } from "@/hooks/useStored";
import { timeAR } from "@/lib/format";
import type { CedearRow } from "@/lib/metrics";
import { DEFAULT_CEDEARS, DEFAULT_CRYPTO, RATIOS } from "@/lib/ratios";
import { AlertsPanel } from "./AlertsPanel";
import { CedearTable } from "./CedearTable";
import { CryptoTable } from "./CryptoTable";
import { DetailPanel, type Selection } from "./DetailPanel";
import { Movers } from "./Movers";
import { type Dolar, TopBar } from "./TopBar";
import { Trading } from "./trading/Trading";

type CedearResponse = { rows: CedearRow[]; cclMedian: number | null; missing: string[]; fetchedAt: number };

export function Terminal() {
  const [cedearList, setCedearList, loaded] = useStored<string[]>("ric.cedears", DEFAULT_CEDEARS);
  const [cryptoList, setCryptoList] = useStored<string[]>("ric.crypto", DEFAULT_CRYPTO);
  const [extraRatios, setExtraRatios] = useStored<Record<string, number>>("ric.ratios", {});
  const [selection, setSelection] = useStored<Selection | null>("ric.selection", { kind: "cedear", ticker: "SPY" });
  const [frame, setFrame] = useStored<Frame>("ric.frame", "6M");
  const [toasts, setToasts] = useState<{ id: number; text: string; icon: string }[]>([]);
  const [tab, setTab] = useStored<"mercado" | "trading">("ric.tab", "mercado");

  const ratiosParam = Object.entries(extraRatios)
    .map(([t, r]) => `${t}:${r}`)
    .join(",");
  const cedearUrl = loaded && cedearList.length ? `/api/cedears?symbols=${cedearList.join(",")}&ratios=${ratiosParam}` : null;
  const cedears = usePolling<CedearResponse>(cedearUrl, 60_000);
  const dolar = usePolling<Dolar[]>("/api/dolar", 60_000);
  const crypto = useCrypto(loaded ? cryptoList : []);

  const cedearRows = useMemo(() => {
    const byTicker = new Map((cedears.data?.rows ?? []).map((r) => [r.ticker, r]));
    return cedearList.map((t) => byTicker.get(t)).filter((r): r is CedearRow => !!r);
  }, [cedears.data, cedearList]);
  const cryptoRows = useMemo(() => cryptoList.map((t) => crypto.rows[t]).filter(Boolean), [crypto.rows, cryptoList]);
  const usdCripto = dolar.data?.find((d) => d.casa === "cripto")?.venta ?? null;

  const prices = useMemo(() => {
    const p: Record<string, number> = {};
    for (const r of cedearRows) p[`cedear:${r.ticker}`] = r.price;
    for (const r of cryptoRows) p[`crypto:${r.ticker}`] = r.price;
    return p;
  }, [cedearRows, cryptoRows]);

  const toast = useCallback((text: string, ok?: boolean) => {
    const id = Date.now() + Math.random();
    const icon = ok === undefined ? "🔔" : ok ? "✅" : "⚠️";
    setToasts((t) => [...t, { id, text, icon }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 12_000);
  }, []);
  const alerts = useAlerts(prices, toast);

  // Orden visible de cada tabla, para moverse con las flechas.
  const order = useRef<{ cedear: string[]; crypto: string[] }>({ cedear: [], crypto: [] });
  const setCedearOrder = useCallback((t: string[]) => (order.current.cedear = t), []);
  const setCryptoOrder = useCallback((t: string[]) => (order.current.crypto = t), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (tab !== "mercado") return;
      if (target.tagName === "INPUT" || target.tagName === "SELECT") {
        if (e.key === "Escape") target.blur();
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        document.getElementById("add-cedear")?.focus();
      } else if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        document.getElementById("alert-input")?.focus();
      } else if (e.key >= "1" && e.key <= String(FRAMES.length)) {
        setFrame(FRAMES[Number(e.key) - 1]);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const kind = selection?.kind ?? "cedear";
        const list = order.current[kind];
        const i = selection ? list.indexOf(selection.ticker) : -1;
        const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
        if (next) setSelection({ kind, ticker: next });
      } else if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey) {
        // Tab salta entre la tabla de CEDEARs y la de cripto.
        e.preventDefault();
        const kind = selection?.kind === "cedear" ? "crypto" : "cedear";
        const first = order.current[kind][0];
        if (first) setSelection({ kind, ticker: first });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, setSelection, setFrame, tab]);

  const addCedear = (raw: string): string | null => {
    const [t, r] = raw.trim().toUpperCase().split(/\s+/);
    if (!/^[A-Z0-9.]{1,10}$/.test(t ?? "")) return "Ticker inválido";
    const ratio = r ? Number(r.replace(",", ".")) : NaN;
    if (r && !(ratio > 0)) return "El ratio tiene que ser un número, por ejemplo: XYZ 4";
    if (ratio > 0) setExtraRatios((prev) => ({ ...prev, [t]: ratio }));
    if (cedearList.includes(t)) return ratio > 0 ? null : `${t} ya está en la lista`;
    setCedearList((prev) => [...prev, t]);
    setSelection({ kind: "cedear", ticker: t });
    return !RATIOS[t] && !(ratio > 0) ? `${t} no está en la tabla de ratios: sin ratio no hay CCL implícito. Agregalo así: ${t} 4` : null;
  };

  const addCrypto = async (raw: string): Promise<string | null> => {
    const t = raw.trim().toUpperCase().replace(/USDT$/, "");
    if (!/^[A-Z0-9]{2,12}$/.test(t)) return "Ticker inválido";
    if (cryptoList.includes(t)) return `${t} ya está en la lista`;
    if (!(await cryptoExists(t))) return `Binance no tiene el par ${t}/USDT`;
    setCryptoList((prev) => [...prev, t]);
    setSelection({ kind: "crypto", ticker: t });
    return null;
  };

  const movers = [
    ...cedearRows.filter((r) => r.changePct != null).map((r) => ({ kind: "cedear" as const, ticker: r.ticker, changePct: r.changePct! })),
    ...cryptoRows.map((r) => ({ kind: "crypto" as const, ticker: r.ticker, changePct: r.changePct })),
  ];

  const missing = cedears.data?.missing ?? [];

  return (
    <div className="app">
      <TopBar dolares={dolar.data} cclLista={cedears.data?.cclMedian ?? null} cryptoLive={crypto.live} tab={tab} onTab={setTab} />
      {tab === "trading" ? <Trading onToast={toast} /> : null}
      <main className="layout" hidden={tab !== "mercado"}>
        <section className="col-main">
          <div className="panel">
            <div className="panel-head">
              <h2>CEDEARs</h2>
              <span className="muted small">
                {cedears.updatedAt ? `Actualizado ${timeAR(cedears.updatedAt, true)} · cada 60 s` : cedears.loading ? "Cargando…" : ""}
                {cedears.error ? ` · error: ${cedears.error}` : ""}
              </span>
              <AddBox id="add-cedear" placeholder="Agregar CEDEAR (ej.: NFLX)" onAdd={addCedear} />
            </div>
            {missing.length ? (
              <div className="notice">
                Sin datos en BYMA para {missing.join(", ")}.{" "}
                <button className="link" onClick={() => setCedearList((prev) => prev.filter((t) => !missing.includes(t)))}>
                  Quitarlos
                </button>
              </div>
            ) : null}
            <div className="table-wrap">
              <CedearTable
                rows={cedearRows}
                selected={selection?.kind === "cedear" ? selection.ticker : null}
                onSelect={(ticker) => setSelection({ kind: "cedear", ticker })}
                onRemove={(t) => setCedearList((prev) => prev.filter((x) => x !== t))}
                onOrder={setCedearOrder}
              />
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Cripto</h2>
              <span className="muted small">
                Binance · {crypto.live ? "en vivo" : "conectando…"}
                {crypto.error ? ` · error: ${crypto.error}` : ""}
              </span>
              <AddBox id="add-crypto" placeholder="Agregar cripto (ej.: AVAX)" onAdd={addCrypto} />
            </div>
            <div className="table-wrap">
              <CryptoTable
                rows={cryptoRows}
                usdArs={usdCripto}
                selected={selection?.kind === "crypto" ? selection.ticker : null}
                onSelect={(ticker) => setSelection({ kind: "crypto", ticker })}
                onRemove={(t) => setCryptoList((prev) => prev.filter((x) => x !== t))}
                onOrder={setCryptoOrder}
              />
            </div>
          </div>

          <div className="row-2">
            <Movers items={movers} onSelect={setSelection} />
            <AlertsPanel alerts={alerts.alerts} onRemove={alerts.remove} />
          </div>
        </section>

        <aside className="col-side">
          <DetailPanel
            selection={selection}
            cedear={selection?.kind === "cedear" ? (cedearRows.find((r) => r.ticker === selection.ticker) ?? null) : null}
            crypto={selection?.kind === "crypto" ? (crypto.rows[selection.ticker] ?? null) : null}
            usdCripto={usdCripto}
            frame={frame}
            onFrame={setFrame}
            onAddAlert={alerts.add}
          />
        </aside>
      </main>
      <footer className="footer muted small" hidden={tab !== "mercado"}>
        <span>
          Teclas: ↑ ↓ moverse · Tab cambiar de tabla · 1–6 marco del gráfico · / agregar CEDEAR · A alerta · Esc salir del campo
        </span>
        <span>Datos: Yahoo Finance (BYMA con demora), Binance, DolarApi. Herramienta de uso personal.</span>
      </footer>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.icon} {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function AddBox({ id, placeholder, onAdd }: { id: string; placeholder: string; onAdd: (v: string) => string | null | Promise<string | null> }) {
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="addbox"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!value.trim()) return;
        const err = await onAdd(value);
        setMsg(err);
        if (!err || err.includes("Agregalo")) setValue("");
      }}
    >
      <input id={id} value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} />
      {msg ? <span className="addbox-msg">{msg}</span> : null}
    </form>
  );
}
