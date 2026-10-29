"use client";
import { useEffect, useState } from "react";
import type { Cotizacion, Estado, Pendiente, Posicion } from "@/lib/trade";

export type CuentaState = {
  estado: Estado | null;
  posiciones: Posicion[];
  pendientes: Pendiente[];
  quotes: Record<string, Cotizacion>;
  error: string | null;
  online: boolean;
};

const EMPTY: CuentaState = { estado: null, posiciones: [], pendientes: [], quotes: {}, error: null, online: false };

// Un stream por cuenta: cotizaciones cada 250 ms, cuenta y posiciones cada segundo.
export function useBroker(cuentas: string[], symbols: Record<string, string[]>) {
  const [state, setState] = useState<Record<string, CuentaState>>({});
  const key = cuentas.map((c) => `${c}:${(symbols[c] ?? []).join(",")}`).join("|");

  useEffect(() => {
    const sources = cuentas.map((cuenta) => {
      const update = (fn: (s: CuentaState) => CuentaState) =>
        setState((prev) => ({ ...prev, [cuenta]: fn(prev[cuenta] ?? EMPTY) }));
      const list = (symbols[cuenta] ?? []).join(",");
      const es = new EventSource(`/api/trade/${cuenta}/stream?symbols=${encodeURIComponent(list)}`);
      es.addEventListener("cotizaciones", (e) => {
        const items: Cotizacion[] = JSON.parse((e as MessageEvent).data);
        update((s) => {
          const quotes = { ...s.quotes };
          for (const q of items) quotes[q.symbol] = q;
          return { ...s, quotes, online: true, error: null };
        });
      });
      es.addEventListener("cuenta", (e) => {
        const d = JSON.parse((e as MessageEvent).data);
        update((s) => ({ ...s, estado: d.estado, posiciones: d.posiciones, pendientes: d.pendientes, online: true, error: null }));
      });
      es.addEventListener("error", (e) => {
        const data = (e as MessageEvent).data;
        let msg = "Sin conexión con el puente";
        try {
          if (data) msg = JSON.parse(data).mensaje ?? msg;
        } catch {
          // Error de red: EventSource reintenta solo.
        }
        update((s) => ({ ...s, online: false, error: msg }));
      });
      return es;
    });
    return () => sources.forEach((s) => s.close());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
