"use client";

import { useCallback, useEffect, useState } from "react";

const DENSITY_KEY = "ui-density";
type Density = "relaxed" | "compact";

function getStoredDensity(): Density {
  if (typeof window === "undefined") return "relaxed";
  return (localStorage.getItem(DENSITY_KEY) as Density) ?? "relaxed";
}

export function useDensity() {
  // Lazy initializer reads localStorage once on first client render,
  // avoiding the flash-of-wrong-density that happens with a "relaxed"
  // default + useEffect update.
  const [density, setDensityState] = useState<Density>(() => getStoredDensity());

  const setDensity = useCallback((d: Density) => {
    setDensityState(d);
    localStorage.setItem(DENSITY_KEY, d);
    const root = document.documentElement;
    if (d === "compact") {
      root.classList.add("density-compact");
    } else {
      root.classList.remove("density-compact");
    }
  }, []);

  const toggleDensity = useCallback(() => {
    setDensity(density === "relaxed" ? "compact" : "relaxed");
  }, [density, setDensity]);

  // Ensure the CSS class is present on mount (the blocking <script> in
  // layout.tsx sets it before first paint, but this is the React-side backup).
  useEffect(() => {
    if (getStoredDensity() === "compact") {
      document.documentElement.classList.add("density-compact");
    }
  }, []);

  return { density, setDensity, toggleDensity };
}
