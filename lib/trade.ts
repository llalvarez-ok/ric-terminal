// Tipos que devuelve el puente de MT5 (bridge/ric_bridge.py).

export type Estado = {
  cuenta: string;
  login: number;
  servidor: string;
  empresa: string;
  moneda: string;
  apalancamiento: number;
  balance: number;
  equity: number;
  resultado_abierto: number;
  margen: number;
  margen_libre: number;
  nivel_margen: number;
  algo_trading: boolean;
  pausado: boolean;
  config: { max_riesgo_pct: number; max_lotes: number; max_ordenes_por_minuto: number };
};

export type Cotizacion = {
  symbol: string;
  descripcion: string;
  bid: number;
  ask: number;
  spread: number | null;
  digitos: number;
  punto: number;
  cierre_anterior: number | null;
  variacion: number | null;
  hora: number;
};

export type Lado = "compra" | "venta";
export type TipoOrden = "mercado" | "limite" | "stop";

export type Posicion = {
  ticket: number;
  symbol: string;
  lado: Lado;
  volumen: number;
  precio_apertura: number;
  precio_actual: number;
  sl: number | null;
  tp: number | null;
  resultado: number;
  swap: number;
  hora: number;
  de_ric: boolean;
  comentario: string;
};

export type Pendiente = {
  ticket: number;
  symbol: string;
  lado: Lado;
  tipo: "limite" | "stop";
  volumen: number;
  precio: number;
  precio_actual: number;
  sl: number | null;
  tp: number | null;
  hora: number;
  de_ric: boolean;
};

export type Calculo = {
  entrada: number;
  volumen: number | null;
  riesgo: number | null;
  riesgo_pct: number | null;
  ganancia_tp: number | null;
  rr: number | null;
  margen: number | null;
  moneda: string;
  volumen_min: number;
  volumen_paso: number;
  errores: string[];
};

export type Respuesta = {
  ok: boolean;
  mensaje: string;
  codigo?: number;
  ticket?: number;
  precio?: number;
  volumen?: number;
  duplicada?: boolean;
  errores?: string[];
};

export async function api<T>(cuenta: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/trade/${cuenta}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json?.detail;
    throw new Error(typeof detail === "string" ? detail : `Error ${res.status}`);
  }
  return json as T;
}

// Los brókers agregan sufijos al nombre (XAUUSDm en Exness, XAUUSD.r en otros).
// Busca el símbolo de la cuenta que corresponde a un nombre base.
export function resolveSymbol(base: string, available: string[], aliases: string[] = []): string | null {
  const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  for (const name of [base, ...aliases]) {
    const b = clean(name);
    const exact = available.find((s) => clean(s) === b);
    if (exact) return exact;
    const near = available
      .filter((s) => clean(s).startsWith(b) && clean(s).length - b.length <= 3)
      .sort((a, b2) => a.length - b2.length)[0];
    if (near) return near;
  }
  return null;
}

export function baseSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

export const DEFAULT_FX: { base: string; aliases?: string[] }[] = [
  { base: "EURUSD" },
  { base: "GBPUSD" },
  { base: "USDJPY" },
  { base: "AUDUSD" },
  { base: "USDCAD" },
  { base: "USDCHF" },
  { base: "XAUUSD", aliases: ["GOLD"] },
  { base: "XAGUSD", aliases: ["SILVER"] },
  { base: "XPTUSD", aliases: ["PLATINUM"] },
  { base: "XCUUSD", aliases: ["COPPER", "XCU", "HGCOPPER"] },
  { base: "BTCUSD" },
  { base: "ETHUSD" },
];
