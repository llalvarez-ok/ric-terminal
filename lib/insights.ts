import { num, pct } from "./format.ts";

// Lectura rápida: traduce los números a frases. Describe el estado del
// papel; no dice qué hacer.

export type Stats = {
  price: number;
  changePct: number | null;
  relVolume: number | null;
  high: number | null; // máximo del período de referencia
  low: number | null;
  rangeLabel: string; // "52 semanas" o "24 h"
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
  vol20: number | null;
  atrPct: number | null;
  premium?: number | null;
  unit?: string; // "ruedas" (bolsa) o "días" (cripto)
  ratioSuspect?: boolean;
};

export type Insight = { tone: "up" | "down" | "neutral" | "warn"; text: string };

export function insights(s: Stats): Insight[] {
  const out: Insight[] = [];
  const unit = s.unit ?? "ruedas";

  if (s.ratioSuspect) {
    out.push({
      tone: "warn",
      text: "El CCL implícito se aleja más de un 15 % del resto: probablemente cambió el ratio. Verificalo en BYMA antes de usar este dato.",
    });
  } else if (s.premium != null) {
    const p = s.premium;
    if (Math.abs(p) < 0.005) {
      out.push({ tone: "neutral", text: "Su CCL implícito está alineado con el promedio de tu lista." });
    } else {
      out.push({
        tone: p > 0 ? "down" : "up",
        text: `Su CCL implícito está ${pct(Math.abs(p), 1, false)} ${p > 0 ? "por encima" : "por debajo"} del promedio de tu lista: en dólares, hoy sale ${p > 0 ? "más caro" : "más barato"} que el resto.`,
      });
    }
  }

  if (s.relVolume != null) {
    if (s.relVolume >= 1.5) {
      out.push({ tone: "neutral", text: `Volumen ${num(s.relVolume, 1)} veces su promedio de 20 ${unit}: hay más movimiento que lo habitual.` });
    } else if (s.relVolume <= 0.4) {
      out.push({ tone: "neutral", text: `Volumen bajo (${num(s.relVolume, 1)} veces el promedio): el precio puede ser poco representativo.` });
    }
  }

  if (s.high != null && s.low != null && s.high > s.low) {
    const toHigh = s.high / s.price - 1;
    const toLow = s.price / s.low - 1;
    if (toHigh <= 0.03) out.push({ tone: "up", text: `Está a ${pct(toHigh, 1, false)} del máximo de ${s.rangeLabel}.` });
    else if (toLow <= 0.03) out.push({ tone: "down", text: `Está a ${pct(toLow, 1, false)} del mínimo de ${s.rangeLabel}.` });
  }

  if (s.sma50 != null && s.sma200 != null) {
    const above50 = s.price > s.sma50;
    const above200 = s.price > s.sma200;
    if (above50 && above200) out.push({ tone: "up", text: `Cotiza por encima de sus medias de 50 y 200 ${unit}: tendencia de fondo alcista.` });
    else if (!above50 && !above200) out.push({ tone: "down", text: `Cotiza por debajo de sus medias de 50 y 200 ${unit}: tendencia de fondo bajista.` });
    else out.push({ tone: "neutral", text: `Está entre la media de 50 (${num(s.sma50)}) y la de 200 (${num(s.sma200)}): tendencia sin definir.` });
  }

  if (s.rsi14 != null) {
    if (s.rsi14 >= 70) out.push({ tone: "warn", text: `RSI ${num(s.rsi14, 0)}: zona de sobrecompra. Subió rápido en poco tiempo.` });
    else if (s.rsi14 <= 30) out.push({ tone: "warn", text: `RSI ${num(s.rsi14, 0)}: zona de sobreventa. Cayó rápido en poco tiempo.` });
  }

  if (s.atrPct != null) {
    out.push({
      tone: "neutral",
      text: `Se mueve en promedio un ${pct(s.atrPct, 1, false)} por día (ATR 14). Un stop más cerca que eso queda dentro del ruido normal.`,
    });
  }

  return out;
}
