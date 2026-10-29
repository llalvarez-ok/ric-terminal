type Props = { values: number[]; width?: number; height?: number; base?: number | null };

// Minigráfico de la sesión. El color sale de comparar el último valor
// con `base` (cierre anterior) o, si no hay, con el primero.
export function Sparkline({ values, width = 84, height = 22, base }: Props) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden />;
  const ref = base ?? values[0];
  const min = Math.min(...values, ref);
  const max = Math.max(...values, ref);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => height - 1 - ((v - min) / span) * (height - 2);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const up = values[values.length - 1] >= ref;
  return (
    <svg width={width} height={height} aria-hidden className="spark">
      <line x1={0} x2={width} y1={y(ref)} y2={y(ref)} className="spark-base" />
      <path d={d} className={up ? "spark-up" : "spark-down"} />
    </svg>
  );
}
