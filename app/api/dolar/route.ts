import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Cotizacion = { casa: string; nombre: string; compra: number | null; venta: number | null; fechaActualizacion: string };

let cache: { at: number; data: Cotizacion[] } | null = null;

export async function GET() {
  if (!cache || Date.now() - cache.at > 60_000) {
    try {
      const res = await fetch("https://dolarapi.com/v1/dolares", {
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) cache = { at: Date.now(), data: await res.json() };
    } catch {
      // Se sirve la última cotización conocida.
    }
  }
  if (!cache) return NextResponse.json({ error: "Sin datos" }, { status: 502 });
  return NextResponse.json(cache.data);
}
