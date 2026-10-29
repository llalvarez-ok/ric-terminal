import { NextResponse } from "next/server";
import { cuentas, token } from "@/lib/broker";

export const dynamic = "force-dynamic";

export async function GET() {
  const list = cuentas();
  return NextResponse.json({
    cuentas: list.map((c) => c.nombre),
    configurado: list.length > 0 && token().length >= 16,
  });
}
