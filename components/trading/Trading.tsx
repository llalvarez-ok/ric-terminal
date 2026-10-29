"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type CuentaState, useBroker } from "@/hooks/useBroker";
import { usePolling } from "@/hooks/usePolling";
import { useStored } from "@/hooks/useStored";
import { num, pct, tone } from "@/lib/format";
import type { Candle } from "@/lib/indicators";
import { api, type Cotizacion, DEFAULT_FX, type Lado, resolveSymbol, type Respuesta } from "@/lib/trade";
import { Flash } from "../Flash";
import { type ChartLine, PriceChart } from "../PriceChart";
import { type ClickTarget, OrderTicket } from "./OrderTicket";
import { Positions } from "./Positions";

const TFS = ["M5", "M15", "H1", "H4", "D1", "W1"] as const;
type Tf = (typeof TFS)[number];
const TF_SECONDS: Record<Tf, number> = { M5: 300, M15: 900, H1: 3600, H4: 14400, D1: 86400, W1: 604800 };

type Selection = { cuenta: string; symbol: string };

export function Trading({ onToast }: { onToast: (text: string, ok?: boolean) => void }) {
  const config = usePolling<{ cuentas: string[]; configurado: boolean }>("/api/trade/cuentas", 60_000);
  const cuentas = config.data?.cuentas ?? [];
  const [lists, setLists, loaded] = useStored<Record<string, string[]>>("ric.fx.listas", {});
  const [catalog, setCatalog] = useState<Record<string, string[]>>({});
  const [sel, setSel] = useStored<Selection | null>("ric.fx.sel", null);
  const [tf, setTf] = useStored<Tf>("ric.fx.tf", "H1");
  const [clickTarget, setClickTarget] = useState<ClickTarget>("sl");
  const [clickPrice, setClickPrice] = useState<{ target: ClickTarget; price: number; n: number } | null>(null);
  const [levels, setLevels] = useState<{ precio: number | null; sl: number | null; tp: number | null; lado: Lado } | null>(null);

  // Catálogo de símbolos de cada cuenta, para resolver nombres con sufijo.
  useEffect(() => {
    for (const c of cuentas) {
      if (catalog[c]) continue;
      api<{ symbol: string }[]>(c, "simbolos")
        .then((items) => setCatalog((prev) => ({ ...prev, [c]: items.map((i) => i.symbol) })))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuentas.join(",")]);

  // Lista inicial: forex mayores, metales y cripto, con el nombre que usa cada bróker.
  useEffect(() => {
    if (!loaded) return;
    const missing = cuentas.filter((c) => !lists[c]?.length && catalog[c]);
    if (!missing.length) return;
    setLists((prev) => {
      const next = { ...prev };
      for (const c of missing) {
        next[c] = DEFAULT_FX.map((d) => resolveSymbol(d.base, catalog[c], d.aliases)).filter((s): s is string => !!s);
      }
      return next;
    });
  }, [loaded, cuentas, catalog, lists, setLists]);

  const broker = useBroker(cuentas, lists);
  const active = sel && cuentas.includes(sel.cuenta) ? sel : cuentas[0] && lists[cuentas[0]]?.[0] ? { cuenta: cuentas[0], symbol: lists[cuentas[0]][0] } : null;
  const quote = active ? (broker[active.cuenta]?.quotes[active.symbol] ?? null) : null;

  const candles = useBrokerCandles(active, tf, quote);

  // Mismo instrumento en las otras cuentas.
  const others = useMemo(() => {
    if (!active) return [];
    const entry = DEFAULT_FX.find((d) => resolveSymbol(d.base, [active.symbol], d.aliases));
    return cuentas
      .filter((c) => c !== active.cuenta && broker[c]?.online)
      .map((c) => {
        const pool = catalog[c] ?? [];
        const symbol = entry ? resolveSymbol(entry.base, pool, entry.aliases) : resolveSymbol(active.symbol.replace(/[^A-Za-z0-9]/g, "").slice(0, 6), pool);
        return symbol ? { cuenta: c, symbol } : null;
      })
      .filter((x): x is { cuenta: string; symbol: string } => !!x);
  }, [active, cuentas, broker, catalog]);

  const lines = useMemo<ChartLine[]>(() => {
    if (!active) return [];
    const s = broker[active.cuenta];
    const out: ChartLine[] = [];
    for (const p of s?.posiciones ?? []) {
      if (p.symbol !== active.symbol) continue;
      out.push({ price: p.precio_apertura, color: p.lado === "compra" ? "#3dd68c" : "#ff6b6b", title: `${p.lado} ${p.volumen}` });
      if (p.sl) out.push({ price: p.sl, color: "#ff6b6b", title: "SL", dashed: true });
      if (p.tp) out.push({ price: p.tp, color: "#3dd68c", title: "TP", dashed: true });
    }
    for (const o of s?.pendientes ?? []) {
      if (o.symbol !== active.symbol) continue;
      out.push({ price: o.precio, color: "#e2c68c", title: `${o.lado} ${o.tipo}`, dashed: true });
    }
    // Niveles de la orden que se está armando.
    if (levels?.precio) out.push({ price: levels.precio, color: "#e2c68c", title: "entrada" });
    if (levels?.sl) out.push({ price: levels.sl, color: "#c7a35e", title: "nuevo SL", dashed: true });
    if (levels?.tp) out.push({ price: levels.tp, color: "#c7a35e", title: "nuevo TP", dashed: true });
    return out;
  }, [active, broker, levels]);

  const result = useCallback((text: string, ok: boolean) => onToast(text, ok), [onToast]);

  if (config.data && !config.data.configurado) return <SetupHelp />;
  if (!cuentas.length) return <div className="panel empty">Cargando cuentas…</div>;

  return (
    <main className="layout trading">
      <section className="col-main">
        <div className="accounts">
          {cuentas.map((c) => (
            <AccountCard key={c} cuenta={c} s={broker[c]} onResult={result} />
          ))}
        </div>

        {cuentas.map((c) => (
          <Watchlist
            key={c}
            cuenta={c}
            symbols={lists[c] ?? []}
            catalog={catalog[c] ?? []}
            quotes={broker[c]?.quotes ?? {}}
            selected={active?.cuenta === c ? active.symbol : null}
            onSelect={(symbol) => setSel({ cuenta: c, symbol })}
            onChange={(next) => setLists((prev) => ({ ...prev, [c]: next }))}
          />
        ))}

        <Positions state={broker} onSelect={(cuenta, symbol) => setSel({ cuenta, symbol })} onResult={result} />
      </section>

      <aside className="col-side">
        {active ? (
          <>
            <div className="panel detail">
              <div className="detail-head">
                <div>
                  <div className="detail-ticker">{active.symbol}</div>
                  <div className="muted small">
                    {quote?.descripcion ?? ""} · {active.cuenta}
                  </div>
                </div>
                <div className="detail-price">
                  <div className="big">{quote ? num(quote.bid, quote.digitos) : "—"}</div>
                  <div className={tone(quote?.variacion)}>
                    {pct(quote?.variacion)} <span className="muted small">hoy · spread {quote?.spread ?? "—"}</span>
                  </div>
                </div>
              </div>
              <div className="toolbar">
                {TFS.map((t) => (
                  <button key={t} className={t === tf ? "on" : ""} onClick={() => setTf(t)}>
                    {t}
                  </button>
                ))}
              </div>
              <div className="chart-wrap">
                <PriceChart
                  key={`${active.cuenta}:${active.symbol}`}
                  candles={candles}
                  showSma
                  precision={quote?.digitos ?? 5}
                  lines={lines}
                  onPriceClick={(price) => setClickPrice((prev) => ({ target: clickTarget, price, n: (prev?.n ?? 0) + 1 }))}
                />
              </div>
              <div className="legend muted small">
                <span className="sw sw-20" /> Media 20 <span className="sw sw-50" /> Media 50 · precios del bróker en vivo · hora de Buenos Aires
              </div>
            </div>
            <OrderTicket
              cuenta={active.cuenta}
              symbol={active.symbol}
              quote={quote}
              candles={candles}
              others={others}
              clickPrice={clickPrice}
              clickTarget={clickTarget}
              onClickTarget={setClickTarget}
              onLevels={setLevels}
              onResult={result}
            />
          </>
        ) : (
          <div className="panel empty">Elegí un símbolo de la lista.</div>
        )}
      </aside>
    </main>
  );
}

// Velas del bróker; la última se actualiza con cada cotización.
function useBrokerCandles(active: Selection | null, tf: Tf, quote: Cotizacion | null): Candle[] {
  const [candles, setCandles] = useState<Candle[]>([]);
  const key = active ? `${active.cuenta}:${active.symbol}:${tf}` : "";

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setCandles([]);
    const load = () =>
      api<Candle[]>(active.cuenta, `velas?symbol=${encodeURIComponent(active.symbol)}&tf=${tf}&n=400`)
        .then((c) => alive && setCandles(c))
        .catch(() => undefined);
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!quote || !candles.length) return;
    const price = quote.bid;
    setCandles((prev) => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      const sec = TF_SECONDS[tf];
      const now = Math.floor(Date.now() / 1000);
      // H4 y mayores se alinean con la hora del bróker: esas se renuevan con la recarga.
      if (sec <= 3600 && now >= last.time + sec) {
        const start = now - (now % sec);
        return [...prev, { time: start, open: price, high: price, low: price, close: price, volume: 0 }];
      }
      if (last.close === price) return prev;
      return [...prev.slice(0, -1), { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.bid]);

  return candles;
}

function AccountCard({ cuenta, s, onResult }: { cuenta: string; s: CuentaState | undefined; onResult: (t: string, ok: boolean) => void }) {
  const e = s?.estado;
  const call = async (path: string, body: unknown, label: string) => {
    try {
      const r = await api<Respuesta & { pausado?: boolean }>(cuenta, path, body);
      onResult(`${cuenta} · ${label}: ${r.mensaje ?? (r.ok ? "listo" : "falló")}`, r.ok);
    } catch (err) {
      onResult(`${cuenta} · ${label}: ${err instanceof Error ? err.message : "Error"}`, false);
    }
  };
  return (
    <div className={`panel account ${s?.online ? "" : "offline"}`}>
      <div className="panel-head">
        <h2>{cuenta}</h2>
        <span className="muted small">{e ? `${e.empresa} · ${e.login} · 1:${e.apalancamiento}` : (s?.error ?? "Conectando…")}</span>
        <span className={`dot ${s?.online ? "dot-on" : "dot-off"}`} />
      </div>
      {e ? (
        <>
          <div className="acct-grid">
            <div>
              <span className="muted">Balance</span>
              <b>{num(e.balance, 2)}</b>
            </div>
            <div>
              <span className="muted">Equity</span>
              <b>{num(e.equity, 2)}</b>
            </div>
            <div>
              <span className="muted">Abierto</span>
              <b className={tone(e.resultado_abierto)}>{num(e.resultado_abierto, 2)}</b>
            </div>
            <div>
              <span className="muted">Margen libre</span>
              <b>{num(e.margen_libre, 2)}</b>
            </div>
            <div>
              <span className="muted">Nivel margen</span>
              <b className={e.nivel_margen && e.nivel_margen < 200 ? "warn" : ""}>{e.margen ? `${num(e.nivel_margen, 0)}%` : "—"}</b>
            </div>
            <div>
              <span className="muted">Riesgo máx.</span>
              <b>{num(e.config.max_riesgo_pct, 1)}% · {num(e.config.max_lotes, 2)} lotes</b>
            </div>
          </div>
          {!e.algo_trading ? <div className="notice">Activá el botón “Algo Trading” en el MT5: sin eso no salen órdenes.</div> : null}
          {e.pausado ? <div className="notice">Trading en pausa: no se mandan órdenes nuevas.</div> : null}
          <div className="acct-actions">
            <button className="mini" onClick={() => call("pausa", { pausado: !e.pausado }, e.pausado ? "reanudar" : "pausar")}>
              {e.pausado ? "Reanudar" : "Pausar"}
            </button>
            <button
              className="mini danger"
              onClick={() => {
                if (window.confirm(`¿Cerrar TODAS las posiciones y cancelar las pendientes de ${cuenta}? La cuenta queda en pausa.`)) {
                  call("cerrar-todo", {}, "cerrar todo");
                }
              }}
            >
              Cerrar todo
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Watchlist(p: {
  cuenta: string;
  symbols: string[];
  catalog: string[];
  quotes: Record<string, Cotizacion>;
  selected: string | null;
  onSelect: (s: string) => void;
  onChange: (next: string[]) => void;
}) {
  const [add, setAdd] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Mercado · {p.cuenta}</h2>
        <form
          className="addbox"
          onSubmit={(e) => {
            e.preventDefault();
            const wanted = add.trim();
            if (!wanted) return;
            const symbol = p.catalog.find((s) => s.toUpperCase() === wanted.toUpperCase()) ?? resolveSymbol(wanted, p.catalog);
            if (!symbol) return setMsg(`${p.cuenta} no tiene ${wanted}`);
            if (p.symbols.includes(symbol)) return setMsg(`${symbol} ya está en la lista`);
            p.onChange([...p.symbols, symbol]);
            p.onSelect(symbol);
            setAdd("");
            setMsg(null);
          }}
        >
          <input list={`cat-${p.cuenta}`} value={add} onChange={(e) => setAdd(e.target.value)} placeholder="Agregar símbolo (ej.: NZDUSD)" />
          <datalist id={`cat-${p.cuenta}`}>
            {p.catalog.slice(0, 300).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          {msg ? <span className="addbox-msg">{msg}</span> : null}
        </form>
      </div>
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Símbolo</th>
              <th>Bid</th>
              <th>Ask</th>
              <th>Spread</th>
              <th>Var. día</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {p.symbols.map((s) => {
              const q = p.quotes[s];
              return (
                <tr key={s} className={s === p.selected ? "selected" : ""} onClick={() => p.onSelect(s)}>
                  <td className="ticker" title={q?.descripcion}>
                    {s}
                  </td>
                  <td className="num">
                    <Flash value={q?.bid ?? null}>{q ? num(q.bid, q.digitos) : "—"}</Flash>
                  </td>
                  <td className="num">
                    <Flash value={q?.ask ?? null}>{q ? num(q.ask, q.digitos) : "—"}</Flash>
                  </td>
                  <td className="num muted">{q?.spread ?? "—"}</td>
                  <td className={`num ${tone(q?.variacion)}`}>{pct(q?.variacion)}</td>
                  <td>
                    <button
                      className="icon"
                      title="Quitar"
                      onClick={(e) => {
                        e.stopPropagation();
                        p.onChange(p.symbols.filter((x) => x !== s));
                      }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SetupHelp() {
  return (
    <main className="layout single">
      <div className="panel setup">
        <h2>Conectar tus cuentas de MetaTrader 5</h2>
        <ol>
          <li>
            Copiá <code>.env.ejemplo</code> como <code>.env.local</code>, completá <code>RIC_BRIDGE_TOKEN</code> y reiniciá la terminal.
          </li>
          <li>
            Abrí cada MT5 (Exness, BlackBull), iniciá sesión y activá el botón <b>Algo Trading</b>.
          </li>
          <li>
            Arrancá un puente por cuenta con <code>iniciar-puentes.ps1</code> (ver <code>bridge/LEEME.md</code>).
          </li>
        </ol>
        <p className="muted small">Mientras tanto, la pestaña Mercado sigue funcionando igual.</p>
      </div>
    </main>
  );
}
