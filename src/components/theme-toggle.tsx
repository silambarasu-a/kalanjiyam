"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun, Monitor } from "lucide-react";

/**
 * Small inline toggle used inside the UserMenu dropdown. Cycles
 * light → dark → system.
 */
export function ThemeCycleItem() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- avoid SSR/CSR mismatch
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const label =
    theme === "light" ? "Light mode" : theme === "dark" ? "Dark mode" : "System theme";

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="w-full flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-accent"
    >
      <Icon className="h-4 w-4" />
      <span className="flex-1 text-left">{label}</span>
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">switch</span>
    </button>
  );
}
