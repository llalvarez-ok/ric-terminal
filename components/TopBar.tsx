"use client";
import { useEffect, useState } from "react";
import { num, pct, timeAR } from "@/lib/format";
import { marketStatuses } from "@/lib/markets";

export type Dolar = { casa: string; nombre: string; compra: number | null; venta: number | null; fechaActualizacion: string };

const CASAS: { casa: string; label: string }[] = [
  { casa: "oficial", label: "Oficial" },
  { casa: "bolsa", label: "MEP" },
  { casa: "contadoconliqui", label: "CCL" },
  { casa: "cripto", label: "Cripto" },
  { casa: "blue", label: "Blue" },
];

type Tab = "mercado" | "trading";

type Props = {
  dolares: Dolar[] | null;
  cclLista: number | null;
  cryptoLive: boolean;
  tab: Tab;
  onTab: (t: Tab) => void;
};

export function TopBar({ dolares, cclLista, cryptoLive, tab, onTab }: Props) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const oficial = dolares?.find((d) => d.casa === "oficial")?.venta ?? null;
  const ccl = dolares?.find((d) => d.casa === "contadoconliqui")?.venta ?? null;

  return (
    <header className="topbar">
      <div className="brand">
        <img src="/logo.svg" alt="Real Investors Club" />
        <span>Terminal</span>
      </div>
      <nav className="tabs">
        {(["mercado", "trading"] as const).map((t) => (
          <button key={t} className={t === tab ? "on" : ""} onClick={() => onTab(t)}>
            {t === "mercado" ? "Mercado" : "Trading"}
          </button>
        ))}
      </nav>
      <div className="clock">{now ? timeAR(now.getTime(), true) : "--:--:--"}</div>
      <div className="markets">
        {now &&
          marketStatuses(now).map((m) => (
            <span key={m.name} className="market" title={m.detail}>
              <span className={`dot ${m.name === "Cripto" ? (cryptoLive ? "dot-on" : "dot-off") : m.open ? "dot-on" : "dot-off"}`} />
              {m.name} <span className="muted">{m.name === "Cripto" ? (cryptoLive ? "en vivo" : "reconectando") : m.detail}</span>
            </span>
          ))}
      </div>
      <div className="fx">
        {CASAS.map(({ casa, label }) => {
          const d = dolares?.find((x) => x.casa === casa);
          return (
            <span key={casa} className="fx-item" title={d ? `Compra ${num(d.compra)} · Venta ${num(d.venta)}` : undefined}>
              <span className="muted">{label}</span> {d?.venta != null ? num(d.venta, 0) : "—"}
            </span>
          );
        })}
        <span className="fx-item" title="Mediana del CCL implícito de los CEDEARs de tu lista">
          <span className="muted">CCL lista</span> <span className="gold">{cclLista != null ? num(cclLista, 0) : "—"}</span>
        </span>
        <span className="fx-item" title="CCL contra el oficial">
          <span className="muted">Brecha</span> {oficial && ccl ? pct(ccl / oficial - 1, 1, false) : "—"}
        </span>
      </div>
    </header>
  );
}
