"use client";
import { useEffect, useRef, useState } from "react";

// Celda que parpadea en verde o rojo cuando cambia el valor.
export function Flash({ value, children, className = "" }: { value: number | null; children: React.ReactNode; className?: string }) {
  const prev = useRef(value);
  const [flash, setFlash] = useState<"" | "flash-up" | "flash-down">("");

  useEffect(() => {
    const old = prev.current;
    prev.current = value;
    if (old == null || value == null || old === value) return;
    setFlash(value > old ? "flash-up" : "flash-down");
    const id = setTimeout(() => setFlash(""), 900);
    return () => clearTimeout(id);
  }, [value]);

  return <span className={`${className} ${flash}`}>{children}</span>;
}
