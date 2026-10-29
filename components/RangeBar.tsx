// Dónde está el precio entre el mínimo y el máximo del período.
export function RangeBar({ pos, title }: { pos: number | null; title?: string }) {
  if (pos == null) return <span className="muted">—</span>;
  return (
    <span className="range" title={title}>
      <span className="range-dot" style={{ left: `${pos * 100}%` }} />
    </span>
  );
}
