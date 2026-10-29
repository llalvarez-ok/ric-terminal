"use client";
import type { Alert } from "@/hooks/useAlerts";
import { price, timeAR } from "@/lib/format";

export function AlertsPanel({ alerts, onRemove }: { alerts: Alert[]; onRemove: (id: string) => void }) {
  const sorted = [...alerts].sort((a, b) => Number(!!a.triggeredAt) - Number(!!b.triggeredAt) || b.createdAt - a.createdAt);
  return (
    <div className="panel">
      <h2>Alertas</h2>
      {!sorted.length ? (
        <p className="muted small pad">Elegí un papel y cargá un precio abajo del gráfico. Suena y aparece un aviso cuando lo toca.</p>
      ) : (
        <ul className="alerts">
          {sorted.map((a) => (
            <li key={a.id} className={a.triggeredAt ? "fired" : ""}>
              <span>
                {a.ticker} {a.op === ">=" ? "≥" : "≤"} {price(a.target)} <span className="muted small">{a.kind === "cedear" ? "ARS" : "USDT"}</span>
              </span>
              <span className="muted small">{a.triggeredAt ? `disparada ${timeAR(a.triggeredAt)}` : "activa"}</span>
              <button className="icon" title="Borrar" onClick={() => onRemove(a.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
