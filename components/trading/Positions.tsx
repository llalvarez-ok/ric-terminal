"use client";
import { useState } from "react";
import type { CuentaState } from "@/hooks/useBroker";
import { num, tone } from "@/lib/format";
import { api, type Posicion, type Respuesta } from "@/lib/trade";
import { parsePrice } from "./OrderTicket";

type Props = {
  state: Record<string, CuentaState>;
  onSelect: (cuenta: string, symbol: string) => void;
  onResult: (text: string, ok: boolean) => void;
};

export function Positions({ state, onSelect, onResult }: Props) {
  const rows = Object.entries(state).flatMap(([cuenta, s]) => s.posiciones.map((p) => ({ cuenta, p, digits: s.quotes[p.symbol]?.digitos ?? 5 })));
  const pend = Object.entries(state).flatMap(([cuenta, s]) => s.pendientes.map((o) => ({ cuenta, o, digits: s.quotes[o.symbol]?.digitos ?? 5 })));
  const total = rows.reduce((a, r) => a + r.p.resultado + r.p.swap, 0);

  const run = async (cuenta: string, path: string, body: unknown, label: string) => {
    try {
      const r = await api<Respuesta>(cuenta, path, body);
      onResult(`${cuenta} · ${label}: ${r.mensaje}`, r.ok);
    } catch (e) {
      onResult(`${cuenta} · ${label}: ${e instanceof Error ? e.message : "Error"}`, false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Posiciones abiertas</h2>
        <span className="muted small">
          {rows.length} abiertas · resultado <span className={tone(total)}>{num(total, 2)}</span>
        </span>
      </div>
      {rows.length ? (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Símbolo</th>
                <th>Lado</th>
                <th>Lotes</th>
                <th>Entrada</th>
                <th>Actual</th>
                <th>SL</th>
                <th>TP</th>
                <th>Resultado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ cuenta, p, digits }) => (
                <PositionRow key={`${cuenta}:${p.ticket}`} cuenta={cuenta} p={p} digits={digits} run={run} onSelect={onSelect} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small pad">Sin posiciones abiertas.</p>
      )}

      {pend.length ? (
        <>
          <h2 className="sub">Órdenes pendientes</h2>
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th>Símbolo</th>
                  <th>Tipo</th>
                  <th>Lotes</th>
                  <th>Precio</th>
                  <th>Actual</th>
                  <th>SL</th>
                  <th>TP</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pend.map(({ cuenta, o, digits }) => (
                  <tr key={`${cuenta}:${o.ticket}`} onClick={() => onSelect(cuenta, o.symbol)}>
                    <td>{cuenta}</td>
                    <td className="ticker">{o.symbol}</td>
                    <td className={o.lado === "compra" ? "up" : "down"}>
                      {o.lado} {o.tipo === "limite" ? "límite" : "stop"}
                    </td>
                    <td className="num">{num(o.volumen, 2)}</td>
                    <td className="num">{num(o.precio, digits)}</td>
                    <td className="num muted">{num(o.precio_actual, digits)}</td>
                    <td className="num">{o.sl ? num(o.sl, digits) : "—"}</td>
                    <td className="num">{o.tp ? num(o.tp, digits) : "—"}</td>
                    <td>
                      <button
                        className="mini"
                        onClick={(e) => {
                          e.stopPropagation();
                          run(cuenta, "cancelar", { ticket: o.ticket }, `cancelar ${o.symbol}`);
                        }}
                      >
                        Cancelar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

function PositionRow({
  cuenta,
  p,
  digits,
  run,
  onSelect,
}: {
  cuenta: string;
  p: Posicion;
  digits: number;
  run: (cuenta: string, path: string, body: unknown, label: string) => Promise<void>;
  onSelect: (cuenta: string, symbol: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [sl, setSl] = useState(p.sl ? p.sl.toFixed(digits) : "");
  const [tp, setTp] = useState(p.tp ? p.tp.toFixed(digits) : "");
  const result = p.resultado + p.swap;

  return (
    <tr onClick={() => onSelect(cuenta, p.symbol)}>
      <td>{cuenta}</td>
      <td className="ticker" title={p.de_ric ? "Abierta desde RIC Terminal" : "Abierta fuera de la terminal"}>
        {p.symbol}
        {p.de_ric ? "" : " ·"}
      </td>
      <td className={p.lado === "compra" ? "up" : "down"}>{p.lado}</td>
      <td className="num">{num(p.volumen, 2)}</td>
      <td className="num">{num(p.precio_apertura, digits)}</td>
      <td className="num">{num(p.precio_actual, digits)}</td>
      {editing ? (
        <>
          <td onClick={(e) => e.stopPropagation()}>
            <input className="cell-input" value={sl} onChange={(e) => setSl(e.target.value)} />
          </td>
          <td onClick={(e) => e.stopPropagation()}>
            <input className="cell-input" value={tp} onChange={(e) => setTp(e.target.value)} placeholder="—" />
          </td>
        </>
      ) : (
        <>
          <td className={`num ${p.sl ? "" : "warn"}`} title={p.sl ? "" : "Posición sin stop loss"}>
            {p.sl ? num(p.sl, digits) : "sin SL"}
          </td>
          <td className="num">{p.tp ? num(p.tp, digits) : "—"}</td>
        </>
      )}
      <td className={`num ${tone(result)}`}>{num(result, 2)}</td>
      <td className="actions" onClick={(e) => e.stopPropagation()}>
        {editing ? (
          <>
            <button
              className="mini"
              onClick={async () => {
                const s = parsePrice(sl);
                if (!s) return;
                await run(cuenta, "modificar", { ticket: p.ticket, sl: s, tp: parsePrice(tp) }, `SL/TP ${p.symbol}`);
                setEditing(false);
              }}
            >
              Guardar
            </button>
            <button className="mini" onClick={() => setEditing(false)}>
              ×
            </button>
          </>
        ) : (
          <>
            <button
              className="mini"
              onClick={() => {
                setSl(p.sl ? p.sl.toFixed(digits) : "");
                setTp(p.tp ? p.tp.toFixed(digits) : "");
                setEditing(true);
              }}
              title="Mover SL o TP"
            >
              SL/TP
            </button>
            <button
              className="mini"
              onClick={() => run(cuenta, "cerrar", { ticket: p.ticket, volumen: p.volumen / 2 }, `cerrar mitad ${p.symbol}`)}
              title="Cerrar la mitad"
            >
              ½
            </button>
            <button className="mini danger" onClick={() => run(cuenta, "cerrar", { ticket: p.ticket }, `cerrar ${p.symbol}`)}>
              Cerrar
            </button>
          </>
        )}
      </td>
    </tr>
  );
}
