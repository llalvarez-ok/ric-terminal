import { NextResponse } from "next/server";
import { cuentas, token } from "@/lib/broker";

export const dynamic = "force-dynamic";

const GET_PATHS = new Set(["estado", "simbolos", "cotizaciones", "velas", "posiciones", "historial", "diario", "stream"]);
const POST_PATHS = new Set(["calcular", "orden", "cerrar", "modificar", "cancelar", "pausa", "cerrar-todo"]);

type Ctx = { params: Promise<{ cuenta: string; path: string[] }> };

async function target(ctx: Ctx, allowed: Set<string>) {
  const { cuenta, path } = await ctx.params;
  const c = cuentas().find((x) => x.nombre === cuenta);
  const p = path.join("/");
  if (!c || !allowed.has(p)) return null;
  return `${c.url}/${p}`;
}

function unreachable(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return NextResponse.json(
    { detail: `No responde el puente de esta cuenta. ¿Está corriendo ric_bridge.py? (${msg})` },
    { status: 502 },
  );
}

export async function GET(req: Request, ctx: Ctx) {
  const url = await target(ctx, GET_PATHS);
  if (!url) return NextResponse.json({ detail: "No encontrado" }, { status: 404 });
  const search = new URL(req.url).search;
  try {
    const res = await fetch(url + search, {
      headers: { "x-ric-token": token() },
      cache: "no-store",
      signal: url.endsWith("/stream") ? req.signal : AbortSignal.timeout(15_000),
    });
    return new Response(res.body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-cache" },
    });
  } catch (e) {
    return unreachable(e);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  // Solo se aceptan órdenes desde la propia terminal: otra página abierta en
  // el navegador no puede mandar una orden a localhost.
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || new URL(origin).host !== host || !req.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json({ detail: "Origen no permitido" }, { status: 403 });
  }
  const url = await target(ctx, POST_PATHS);
  if (!url) return NextResponse.json({ detail: "No encontrado" }, { status: 404 });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-ric-token": token(), "content-type": "application/json" },
      body: await req.text(),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
  } catch (e) {
    return unreachable(e);
  }
}
