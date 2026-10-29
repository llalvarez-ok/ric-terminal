// Estado de las ruedas. No contempla feriados: en un feriado figura
// "abierto" aunque no haya operaciones (los precios no se mueven).

export type MarketStatus = { name: string; open: boolean; detail: string };

function clockIn(timeZone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const minutes = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
  const weekend = get("weekday") === "Sat" || get("weekday") === "Sun";
  return { minutes, weekend };
}

function session(name: string, timeZone: string, from: number, to: number, now: Date): MarketStatus {
  const { minutes, weekend } = clockIn(timeZone, now);
  const open = !weekend && minutes >= from && minutes < to;
  let detail: string;
  if (open) detail = `cierra en ${fmt(to - minutes)}`;
  else if (!weekend && minutes < from) detail = `abre en ${fmt(from - minutes)}`;
  else detail = "cerrado";
  return { name, open, detail };
}

function fmt(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

export function marketStatuses(now = new Date()): MarketStatus[] {
  return [
    session("BYMA", "America/Argentina/Buenos_Aires", 11 * 60, 17 * 60, now),
    session("NYSE", "America/New_York", 9 * 60 + 30, 16 * 60, now),
    { name: "Cripto", open: true, detail: "24/7" },
  ];
}
