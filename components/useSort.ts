"use client";
import { useMemo, useState } from "react";

export type SortState<K extends string> = { key: K | null; dir: 1 | -1 };

// Orden por columna: primer clic descendente, segundo ascendente, tercero sin orden.
export function useSort<T, K extends string>(rows: T[], get: (row: T, key: K) => number | string | null) {
  const [sort, setSort] = useState<SortState<K>>({ key: null, dir: -1 });
  const sorted = useMemo(() => {
    if (!sort.key) return rows;
    const key = sort.key;
    return [...rows].sort((a, b) => {
      const va = get(a, key);
      const vb = get(b, key);
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);
  const toggle = (key: K) =>
    setSort((s) => (s.key !== key ? { key, dir: -1 } : s.dir === -1 ? { key, dir: 1 } : { key: null, dir: -1 }));
  const mark = (key: K) => (sort.key === key ? (sort.dir === -1 ? " ▼" : " ▲") : "");
  return { sorted, toggle, mark };
}
