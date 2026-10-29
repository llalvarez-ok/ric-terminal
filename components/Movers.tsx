"use client";
import { pct, tone } from "@/lib/format";
import type { Selection } from "./DetailPanel";

export type Mover = { kind: Selection["kind"]; ticker: string; changePct: number };

export function Movers({ items, onSelect }: { items: Mover[]; onSelect: (s: Selection) => void }) {
  const ups = items.filter((i) => i.changePct > 0).sort((a, b) => b.changePct - a.changePct).slice(0, 5);
  const downs = items.filter((i) => i.changePct < 0).sort((a, b) => a.changePct - b.changePct).slice(0, 5);
  const list = (rows: Mover[], empty: string) =>
    rows.length ? (
      rows.map((m) => (
        <li key={`${m.kind}:${m.ticker}`} onClick={() => onSelect({ kind: m.kind, ticker: m.ticker })}>
          <span>
            {m.ticker} <span className="tag">{m.kind === "cedear" ? "CED" : "CRI"}</span>
          </span>
          <span className={tone(m.changePct)}>{pct(m.changePct)}</span>
        </li>
      ))
    ) : (
      <li className="muted">{empty}</li>
    );
  return (
    <div className="panel">
      <h2>Los que más se mueven</h2>
      <div className="movers">
        <ul>{list(ups, "Nada sube")}</ul>
        <ul>{list(downs, "Nada baja")}</ul>
      </div>
    </div>
  );
}
