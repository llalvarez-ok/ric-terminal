"use client";
import { compact, pct, price, tone } from "@/lib/format";
import type { CryptoRow } from "@/hooks/useCrypto";
import { Flash } from "./Flash";
import { RangeBar } from "./RangeBar";
import { Sparkline } from "./Sparkline";
import { useSort } from "./useSort";

type Key = "ticker" | "price" | "changePct" | "quoteVolume" | "rangePos";

type Props = {
  rows: CryptoRow[];
  usdArs: number | null; // dólar cripto
  selected: string | null;
  onSelect: (ticker: string) => void;
  onRemove: (ticker: string) => void;
  onOrder: (tickers: string[]) => void;
};

const rangePos = (r: CryptoRow) => (r.high > r.low ? (r.price - r.low) / (r.high - r.low) : null);

export function CryptoTable({ rows, usdArs, selected, onSelect, onRemove, onOrder }: Props) {
  const { sorted, toggle, mark } = useSort<CryptoRow, Key>(rows, (r, k) => (k === "rangePos" ? rangePos(r) : r[k]));
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
          {th("price", "Precio USDT")}
          {th("changePct", "Var. 24 h")}
          <th>Últ. 24 h</th>
          {th("rangePos", "Rango 24 h", "Posición entre el mínimo y el máximo de las últimas 24 horas")}
          {th("quoteVolume", "Volumen", "Volumen operado en 24 h, en USDT")}
          <th title="Al dólar cripto">≈ ARS</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.ticker} className={r.ticker === selected ? "selected" : ""} onClick={() => onSelect(r.ticker)}>
            <td className="ticker">{r.ticker}</td>
            <td className="num">
              <Flash value={r.price}>{price(r.price)}</Flash>
            </td>
            <td className={`num ${tone(r.changePct)}`}>{pct(r.changePct)}</td>
            <td>
              <Sparkline values={r.spark} base={r.open} />
            </td>
            <td>
              <RangeBar pos={rangePos(r)} title={`Mín. ${price(r.low)} · Máx. ${price(r.high)}`} />
            </td>
            <td className="num">{compact(r.quoteVolume)}</td>
            <td className="num muted">{usdArs ? price(r.price * usdArs) : "—"}</td>
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
