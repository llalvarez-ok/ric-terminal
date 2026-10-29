// Cuentas de MT5 configuradas en .env.local:
//   RIC_CUENTAS=exness:8701,blackbull:8702
//   RIC_BRIDGE_TOKEN=<el mismo token con el que se arrancan los puentes>

export type CuentaConfig = { nombre: string; url: string };

export function cuentas(): CuentaConfig[] {
  return (process.env.RIC_CUENTAS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [nombre, puerto] = s.split(":");
      return { nombre: nombre.toLowerCase(), url: `http://127.0.0.1:${Number(puerto)}` };
    })
    .filter((c) => /^[a-z0-9_-]{1,20}$/.test(c.nombre) && !c.url.endsWith(":NaN"));
}

export function token(): string {
  return process.env.RIC_BRIDGE_TOKEN ?? "";
}
