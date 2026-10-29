"use client";
import { num, pct, price, tone } from "@/lib/format";
import type { CedearRow } from "@/lib/metrics";
import { Flash } from "./Flash";
import { RangeBar } from "./RangeBar";
import { Sparkline } from "./Sparkline";
import { useSort } from "./useSort";

type Key = "ticker" | "price" | "changePct" | "relVolume" | "rangePos" | "usChangePct" | "ccl" | "premium" | "rsi14";

type Props = {
  rows: CedearRow[];
  selected: string | null;
  onSelect: (ticker: string) => void;
  onRemove: (ticker: string) => void;
  onOrder: (tickers: string[]) => void;
};

export function CedearTable({ rows, selected, onSelect, onRemove, onOrder }: Props) {
  const { sorted, toggle, mark } = useSort<CedearRow, Key>(rows, (r, k) => r[k] as number | string | null);
  // El orden visible es el que usan las flechas del teclado.
  onOrder(sorted.map((r) => r.ticker));

  const th = (key: Key, label: string, title?: string) => (
    <th onClick={() => toggle(key)} title={title} className="sortable">
      {label}
      {mark(key)}
    </th>
  );

  return (
    <table className="grid">
      <thead>
        <tr>
          {th("ticker", "Ticker")}
          {th("price", "Precio ARS")}
          {th("changePct", "Var.")}
          <th>Hoy</th>
          {th("relVolume", "Vol. rel.", "Volumen de la rueda contra el promedio de 20 ruedas. Con la rueda abierta, se ajusta por la hora")}
          {th("rangePos", "52 sem.", "Posición entre el mínimo y el máximo de 52 semanas")}
          {th("usChangePct", "EE.UU.", "Precio y variación de la acción en EE.UU.")}
          {th("ccl", "CCL impl.", "Precio ARS × ratio ÷ precio USD")}
          {th("premium", "Prem.", "CCL implícito contra la mediana de tu lista")}
          {th("rsi14", "RSI")}
          <th />
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.ticker} className={r.ticker === selected ? "selected" : ""} onClick={() => onSelect(r.ticker)}>
            <td className="ticker" title={`${r.name} · ratio ${num(r.ratio, r.ratio % 1 ? 2 : 0)}:1`}>
              {r.ticker}
            </td>
            <td className="num">
              <Flash value={r.price}>{price(r.price)}</Flash>
            </td>
            <td className={`num ${tone(r.changePct)}`}>{pct(r.changePct)}</td>
            <td>
              <Sparkline values={r.spark} base={r.changePct != null ? r.price / (1 + r.changePct) : null} />
            </td>
            <td className={`num ${r.relVolume != null && r.relVolume >= 1.5 ? "hot" : ""}`}>
              {r.relVolume != null ? `${num(r.relVolume, 1)}x` : "—"}
            </td>
            <td>
              <RangeBar pos={r.rangePos} title={`Mín. ${price(r.low52)} · Máx. ${price(r.high52)}`} />
            </td>
            <td className="num">
              <span className="muted">{price(r.usPrice)}</span>{" "}
              <span className={tone(r.usChangePct)}>{pct(r.usChangePct, 1)}</span>
            </td>
            <td className={`num ${r.ratioSuspect ? "warn" : ""}`} title={r.ratioSuspect ? "Ratio a verificar" : undefined}>
              {r.ccl != null ? num(r.ccl, 0) : r.ratio ? "—" : "sin ratio"}
              {r.ratioSuspect ? " ⚠" : ""}
            </td>
            <td className={`num ${r.ratioSuspect ? "muted" : r.premium != null && Math.abs(r.premium) >= 0.02 ? "hot" : ""}`}>
              {pct(r.premium, 1)}
            </td>
            <td className={`num ${r.rsi14 != null && (r.rsi14 >= 70 || r.rsi14 <= 30) ? "hot" : ""}`}>{num(r.rsi14, 0)}</td>
            <td>
              <button
                className="icon"
                title="Quitar de la lista"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(r.ticker);
                }}
              >
                ×
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
