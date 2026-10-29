"use client";
import { useCallback, useEffect, useRef } from "react";
import { price as fmtPrice } from "@/lib/format";
import { useStored } from "./useStored";

export type Alert = {
  id: string;
  kind: "cedear" | "crypto";
  ticker: string;
  op: ">=" | "<=";
  target: number;
  createdAt: number;
  triggeredAt: number | null;
};

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch {
    // Sin audio disponible.
  }
}

function notify(a: Alert, current: number) {
  const unit = a.kind === "cedear" ? "ARS" : "USDT";
  const text = `${a.ticker} ${a.op === ">=" ? "subió a" : "bajó a"} ${fmtPrice(a.target)} ${unit} (ahora ${fmtPrice(current)})`;
  beep();
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification("Alerta de precio", { body: text });
  }
  return text;
}

// Alertas de precio guardadas en el navegador. Se disparan una sola vez.
export function useAlerts(prices: Record<string, number>, onFire: (text: string) => void) {
  const [alerts, setAlerts] = useStored<Alert[]>("ric.alerts", []);
  const fireRef = useRef(onFire);
  fireRef.current = onFire;

  useEffect(() => {
    const fired: { id: string; text: string }[] = [];
    for (const a of alerts) {
      if (a.triggeredAt) continue;
      const p = prices[`${a.kind}:${a.ticker}`];
      if (p == null) continue;
      if ((a.op === ">=" && p >= a.target) || (a.op === "<=" && p <= a.target)) {
        fired.push({ id: a.id, text: notify(a, p) });
      }
    }
    if (!fired.length) return;
    const ids = new Set(fired.map((f) => f.id));
    setAlerts((prev) => prev.map((a) => (ids.has(a.id) ? { ...a, triggeredAt: Date.now() } : a)));
    fired.forEach((f) => fireRef.current(f.text));
  }, [prices, alerts, setAlerts]);

  const add = useCallback(
    (a: Omit<Alert, "id" | "createdAt" | "triggeredAt">) => {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission();
      }
      setAlerts((prev) => [...prev, { ...a, id: crypto.randomUUID(), createdAt: Date.now(), triggeredAt: null }]);
    },
    [setAlerts],
  );

  const remove = useCallback((id: string) => setAlerts((prev) => prev.filter((a) => a.id !== id)), [setAlerts]);

  return { alerts, add, remove };
}
