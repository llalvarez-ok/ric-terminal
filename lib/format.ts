// Formato argentino: coma decimal y punto de miles.

export function num(value: number | null | undefined, decimals = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("es-AR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Precio con decimales según su tamaño (cripto chicas necesitan más).
export function price(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const decimals = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return num(value, decimals);
}

export function pct(value: number | null | undefined, decimals = 2, sign = true): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const s = num(value * 100, decimals);
  return `${sign && value > 0 ? "+" : ""}${s}%`;
}

export function compact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${num(value / 1e9, 1)} B`;
  if (abs >= 1e6) return `${num(value / 1e6, 1)} M`;
  if (abs >= 1e3) return `${num(value / 1e3, 1)} K`;
  return num(value, 0);
}

export function tone(value: number | null | undefined): "up" | "down" | "flat" {
  if (value == null || !Number.isFinite(value) || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}

export function timeAR(unixMs: number, withSeconds = false): string {
  return new Date(unixMs).toLocaleTimeString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    hour12: false,
  });
}

// Acepta "1.234,5", "1234,5", "81.500" (miles) y "0.5" (decimal).
export function parseAmount(raw: string): number {
  const v = raw.trim().replace(/\s/g, "");
  if (v.includes(",")) return Number(v.replace(/\./g, "").replace(",", "."));
  const dots = v.split(".").length - 1;
  if (dots > 1 || /^[1-9]\d{0,2}\.\d{3}$/.test(v)) return Number(v.replace(/\./g, ""));
  return Number(v);
}
