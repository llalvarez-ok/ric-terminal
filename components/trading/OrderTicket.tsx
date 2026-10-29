"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStored } from "@/hooks/useStored";
import { num } from "@/lib/format";
import { type Candle, atr } from "@/lib/indicators";
import { api, type Calculo, type Cotizacion, type Lado, type Respuesta, type TipoOrden } from "@/lib/trade";

export type ClickTarget = "sl" | "tp" | "precio";

type Target = { cuenta: string; symbol: string };

type Props = {
  cuenta: string;
  symbol: string;
  quote: Cotizacion | null;
  candles: Candle[];
  // Símbolo equivalente en las otras cuentas conectadas (para operar en todas a la vez).
  others: Target[];
  clickPrice: { target: ClickTarget; price: number; n: number } | null;
  clickTarget: ClickTarget;
  onClickTarget: (t: ClickTarget) => void;
  onLevels: (levels: { precio: number | null; sl: number | null; tp: number | null; lado: Lado }) => void;
  onResult: (text: string, ok: boolean) => void;
};

type Sizing = "pct" | "monto" | "lotes";
type Plan = Target & { calc: Calculo | null; error: string | null };

// Acepta coma o punto como separador decimal. En precios de forex no hay miles.
export function parsePrice(raw: string): number | null {
  const v = raw.trim().replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function OrderTicket(p: Props) {
  const { cuenta, symbol, quote } = p;
  const [lado, setLado] = useState<Lado>("compra");
  const [tipo, setTipo] = useState<TipoOrden>("mercado");
  const [precio, setPrecio] = useState("");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [sizing, setSizing] = useStored<Sizing>("ric.ticket.sizing", "pct");
  const [size, setSize] = useStored<string>("ric.ticket.size", "1");
  const [confirmar, setConfirmar] = useStored<boolean>("ric.ticket.confirmar", true);
  const [todas, setTodas] = useStored<boolean>("ric.ticket.todas", false);
  const [calc, setCalc] = useState<Calculo | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [sending, setSending] = useState(false);

  const digits = quote?.digitos ?? 5;
  const fmt = (v: number) => v.toFixed(digits);

  // Al cambiar de símbolo, limpiar niveles.
  useEffect(() => {
    setPrecio("");
    setSl("");
    setTp("");
    setCalc(null);
    setPlans(null);
  }, [cuenta, symbol]);

  // Clic en el gráfico.
  useEffect(() => {
    if (!p.clickPrice) return;
    const v = fmt(p.clickPrice.price);
    if (p.clickPrice.target === "sl") setSl(v);
    else if (p.clickPrice.target === "tp") setTp(v);
    else {
      setPrecio(v);
      if (tipo === "mercado") setTipo("limite");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.clickPrice?.n]);

  const entry = tipo === "mercado" ? (quote ? (lado === "compra" ? quote.ask : quote.bid) : null) : parsePrice(precio);
  const slN = parsePrice(sl);
  const tpN = parsePrice(tp);
  const sizeN = parsePrice(size);

  useEffect(() => {
    p.onLevels({ precio: tipo === "mercado" ? null : entry, sl: slN, tp: tpN, lado });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, slN, tpN, lado, tipo]);

  const body = (sym: string) => ({
    symbol: sym,
    lado,
    tipo,
    precio: tipo === "mercado" ? null : entry,
    sl: slN,
    tp: tpN,
    riesgo_pct: sizing === "pct" ? sizeN : null,
    riesgo_monto: sizing === "monto" ? sizeN : null,
    volumen: sizing === "lotes" ? sizeN : null,
  });

  // Cálculo en vivo: tamaño, riesgo y margen. Se repite cada 2 s por el precio de mercado.
  const reqKey = JSON.stringify(body(symbol)) + cuenta;
  const reqRef = useRef(reqKey);
  reqRef.current = reqKey;
  useEffect(() => {
    if (!slN || !sizeN || !entry) {
      setCalc(null);
      setCalcError(null);
      return;
    }
    let alive = true;
    const run = () =>
      api<Calculo>(cuenta, "calcular", body(symbol))
        .then((c) => {
          if (alive && reqRef.current === reqKey) {
            setCalc(c);
            setCalcError(null);
          }
        })
        .catch((e) => alive && setCalcError(e.message));
    const first = setTimeout(run, 250);
    const every = tipo === "mercado" ? setInterval(run, 2000) : undefined;
    return () => {
      alive = false;
      clearTimeout(first);
      if (every) clearInterval(every);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey]);

  const atrValue = useMemo(() => atr(p.candles), [p.candles]);

  const setSlAtr = (k: number) => {
    if (!entry || !atrValue) return;
    setSl(fmt(lado === "compra" ? entry - k * atrValue : entry + k * atrValue));
  };
  const setTpRr = (r: number) => {
    if (!entry || !slN) return;
    const d = Math.abs(entry - slN) * r;
    setTp(fmt(lado === "compra" ? entry + d : entry - d));
  };

  const prepare = async (): Promise<Plan[]> => {
    const targets: Target[] = [{ cuenta, symbol }, ...(todas ? p.others : [])];
    return Promise.all(
      targets.map(async (t) => {
        try {
          const c = await api<Calculo>(t.cuenta, "calcular", body(t.symbol));
          return { ...t, calc: c, error: c.errores.length ? c.errores.join(" ") : c.volumen ? null : "Sin volumen" };
        } catch (e) {
          return { ...t, calc: null, error: e instanceof Error ? e.message : "Error" };
        }
      }),
    );
  };

  const execute = async (list: Plan[]) => {
    setSending(true);
    let anyOk = false;
    try {
      await Promise.all(
        list
          .filter((pl) => !pl.error && pl.calc?.volumen)
          .map(async (pl) => {
            try {
              const r = await api<Respuesta>(pl.cuenta, "orden", {
                client_id: crypto.randomUUID(),
                symbol: pl.symbol,
                lado,
                tipo,
                volumen: pl.calc!.volumen,
                precio: tipo === "mercado" ? null : entry,
                sl: slN,
                tp: tpN,
                origen: "manual",
              });
              anyOk ||= r.ok;
              p.onResult(
                `${pl.cuenta} · ${pl.symbol}: ${r.mensaje}${r.ok && r.precio ? ` a ${num(r.precio, digits)}` : ""}`,
                r.ok,
              );
            } catch (e) {
              p.onResult(`${pl.cuenta} · ${pl.symbol}: ${e instanceof Error ? e.message : "Error"}`, false);
            }
          }),
      );
    } finally {
      setSending(false);
      setPlans(null);
      // Boleta limpia tras una orden: evita repetirla sin querer con un segundo clic.
      if (anyOk) {
        setSl("");
        setTp("");
        setPrecio("");
      }
    }
  };

  const submit = async () => {
    if (sending) return;
    const list = await prepare();
    const sendable = list.filter((pl) => !pl.error);
    if (!sendable.length) {
      list.forEach((pl) => p.onResult(`${pl.cuenta} · ${pl.symbol}: ${pl.error}`, false));
      return;
    }
    if (confirmar) setPlans(list);
    else await execute(list);
  };

  const ready = !!(entry && slN && sizeN && calc && !calc.errores.length && calc.volumen);
  const cur = calc?.moneda ?? "USD";

  return (
    <div className="panel ticket">
      <div className="panel-head">
        <h2>Orden</h2>
        <span className="muted small">
          {cuenta} · {symbol}
        </span>
      </div>

      <div className="seg">
        <button className={lado === "compra" ? "on-buy" : ""} onClick={() => setLado("compra")}>
          Compra {quote ? fmt(quote.ask) : ""}
        </button>
        <button className={lado === "venta" ? "on-sell" : ""} onClick={() => setLado("venta")}>
          Venta {quote ? fmt(quote.bid) : ""}
        </button>
      </div>

      <div className="seg small-seg">
        {(["mercado", "limite", "stop"] as const).map((t) => (
          <button key={t} className={tipo === t ? "on" : ""} onClick={() => setTipo(t)}>
            {t === "mercado" ? "Mercado" : t === "limite" ? "Límite" : "Stop"}
          </button>
        ))}
      </div>

      <div className="fields">
        {tipo !== "mercado" && (
          <label>
            <span>Precio</span>
            <input value={precio} onChange={(e) => setPrecio(e.target.value)} inputMode="decimal" placeholder={quote ? fmt(quote.bid) : ""} />
          </label>
        )}
        <label>
          <span>
            Stop loss <b className="req">*</b>
          </span>
          <input value={sl} onChange={(e) => setSl(e.target.value)} inputMode="decimal" />
        </label>
        <div className="quick">
          {[1, 1.5, 2].map((k) => (
            <button key={k} onClick={() => setSlAtr(k)} disabled={!atrValue || !entry} title={atrValue ? `ATR 14 del marco del gráfico = ${fmt(atrValue)}` : ""}>
              {num(k, k % 1 ? 1 : 0)} ATR
            </button>
          ))}
        </div>
        <label>
          <span>Take profit</span>
          <input value={tp} onChange={(e) => setTp(e.target.value)} inputMode="decimal" placeholder="opcional" />
        </label>
        <div className="quick">
          {[1, 2, 3].map((r) => (
            <button key={r} onClick={() => setTpRr(r)} disabled={!slN || !entry}>
              1:{r}
            </button>
          ))}
        </div>
        <label>
          <span>Tamaño</span>
          <span className="size-row">
            <input value={size} onChange={(e) => setSize(e.target.value)} inputMode="decimal" />
            <select value={sizing} onChange={(e) => setSizing(e.target.value as Sizing)}>
              <option value="pct">% de riesgo</option>
              <option value="monto">{cur} de riesgo</option>
              <option value="lotes">lotes</option>
            </select>
          </span>
        </label>
      </div>

      <div className="clicks muted small">
        Clic en el gráfico fija:{" "}
        {(["sl", "tp", "precio"] as const).map((t) => (
          <button key={t} className={`chip ${p.clickTarget === t ? "on" : ""}`} onClick={() => p.onClickTarget(t)}>
            {t === "sl" ? "SL" : t === "tp" ? "TP" : "Precio"}
          </button>
        ))}
      </div>

      <div className="calc">
        <div>
          <span className="muted">Lotes</span>
          <b>{calc?.volumen != null ? num(calc.volumen, 2) : "—"}</b>
        </div>
        <div>
          <span className="muted">Riesgo</span>
          <b className="down">
            {calc?.riesgo != null ? `${num(calc.riesgo, 2)} ${cur}` : "—"}
            {calc?.riesgo_pct != null ? ` · ${num(calc.riesgo_pct, 2)}%` : ""}
          </b>
        </div>
        <div>
          <span className="muted">En el TP</span>
          <b className="up">{calc?.ganancia_tp != null ? `${num(calc.ganancia_tp, 2)} ${cur}` : "—"}</b>
        </div>
        <div>
          <span className="muted">R:R</span>
          <b>{calc?.rr != null ? `1:${num(calc.rr, 2)}` : "—"}</b>
        </div>
        <div>
          <span className="muted">Margen</span>
          <b>{calc?.margen != null ? `${num(calc.margen, 2)} ${cur}` : "—"}</b>
        </div>
      </div>
      {calc?.errores.length ? (
        <ul className="errors">
          {calc.errores.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      {calcError ? <div className="errors">{calcError}</div> : null}
      {!slN ? <div className="muted small">El stop loss es obligatorio.</div> : null}

      <div className="toggles">
        <label className="check">
          <input type="checkbox" checked={confirmar} onChange={(e) => setConfirmar(e.target.checked)} />
          Confirmar antes de enviar
        </label>
        {p.others.length ? (
          <label className="check" title={p.others.map((o) => `${o.cuenta}: ${o.symbol}`).join(" · ")}>
            <input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} />
            También en {p.others.map((o) => o.cuenta).join(" y ")}
          </label>
        ) : null}
      </div>
      {!confirmar ? <div className="warn small">Ejecución directa: la orden sale con un solo clic.</div> : null}

      <button className={`send ${lado === "compra" ? "send-buy" : "send-sell"}`} disabled={!ready || sending} onClick={submit}>
        {sending ? "Enviando…" : `${lado === "compra" ? "Comprar" : "Vender"} ${calc?.volumen ? num(calc.volumen, 2) : ""} ${symbol}`}
      </button>

      {plans ? (
        <div className="modal-back" onClick={() => setPlans(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Confirmar orden</h2>
            <p>
              {lado === "compra" ? "Compra" : "Venta"} {tipo === "mercado" ? "a mercado" : `${tipo === "limite" ? "límite" : "stop"} a ${precio}`} · SL {sl}
              {tp ? ` · TP ${tp}` : ""}
            </p>
            <table className="grid">
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th>Símbolo</th>
                  <th>Lotes</th>
                  <th>Riesgo</th>
                  <th>Margen</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((pl) => (
                  <tr key={pl.cuenta}>
                    <td>{pl.cuenta}</td>
                    <td>{pl.symbol}</td>
                    {pl.error ? (
                      <td colSpan={3} className="warn">
                        {pl.error}
                      </td>
                    ) : (
                      <>
                        <td className="num">{num(pl.calc!.volumen, 2)}</td>
                        <td className="num down">
                          {num(pl.calc!.riesgo, 2)} {pl.calc!.moneda} ({num(pl.calc!.riesgo_pct, 2)}%)
                        </td>
                        <td className="num">{num(pl.calc!.margen, 2)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="modal-actions">
              <button onClick={() => setPlans(null)}>Cancelar</button>
              <button className={`send ${lado === "compra" ? "send-buy" : "send-sell"}`} disabled={sending} onClick={() => execute(plans)}>
                {sending ? "Enviando…" : "Enviar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
