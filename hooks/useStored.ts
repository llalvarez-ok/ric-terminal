"use client";
import { useCallback, useEffect, useState } from "react";

// Estado que se guarda en el navegador. Arranca con el valor por defecto
// y carga lo guardado después de montar, para no romper la hidratación.
export function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setValue(JSON.parse(raw));
    } catch {
      // Sin almacenamiento: se usa el valor por defecto.
    }
    setLoaded(true);
  }, [key]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          localStorage.setItem(key, JSON.stringify(v));
        } catch {
          // Se pierde al recargar, pero la sesión sigue.
        }
        return v;
      });
    },
    [key],
  );

  return [value, update, loaded] as const;
}
