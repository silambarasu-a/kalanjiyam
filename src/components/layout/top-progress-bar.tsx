"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Thin horizontal progress strip rendered just below the top bar.
 *
 * Triggered by:
 *   - Any `window.fetch` call (covers SWR data loads, server actions
 *     hitting fetch under the hood, manual fetches in click handlers, etc).
 *   - Pathname changes — a brief pulse for snappier route-transition
 *     feedback even if no fetch fires.
 *
 * Multiple concurrent loads are tracked via a counter so the bar only
 * disappears once everything in flight has settled.
 */
export function TopProgressBar() {
  const [width, setWidth] = useState(0);
  const [opacity, setOpacity] = useState(0);
  const inFlightRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();

  // Refs so we can call from inside the patched fetch without re-running
  // the effect on every state change.
  const startRef = useRef<() => void>(() => {});
  const doneRef = useRef<() => void>(() => {});

  startRef.current = () => {
    inFlightRef.current += 1;
    if (inFlightRef.current > 1) return;
    if (fadeRef.current) {
      clearTimeout(fadeRef.current);
      fadeRef.current = null;
    }
    setOpacity(1);
    setWidth(10);
    // Asymptotic crawl toward 90%; never reach 100 until finished.
    tickRef.current = setInterval(() => {
      setWidth((w) => Math.min(90, w + (90 - w) * 0.07));
    }, 120);
  };

  doneRef.current = () => {
    inFlightRef.current = Math.max(0, inFlightRef.current - 1);
    if (inFlightRef.current > 0) return;
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    setWidth(100);
    // Hold at 100% long enough that even sub-100ms fetches register
    // visually, then fade out.
    fadeRef.current = setTimeout(() => {
      setOpacity(0);
      fadeRef.current = setTimeout(() => setWidth(0), 300);
    }, 400);
  };

  // Patch fetch once on mount. Restored on unmount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const original = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      startRef.current();
      try {
        return await original(...args);
      } finally {
        doneRef.current();
      }
    };
    return () => {
      window.fetch = original;
      if (tickRef.current) clearInterval(tickRef.current);
      if (fadeRef.current) clearTimeout(fadeRef.current);
    };
  }, []);

  // Pulse on every pathname change. If the new page issues fetches, those
  // will keep the bar alive past this 400ms minimum.
  useEffect(() => {
    startRef.current();
    const t = setTimeout(() => doneRef.current(), 400);
    return () => clearTimeout(t);
  }, [pathname]);

  return (
    <div
      aria-hidden
      className="relative z-20 h-[2.5px] w-full overflow-hidden bg-transparent"
    >
      <div
        className="absolute inset-y-0 left-0 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] transition-[width,opacity] duration-200 ease-out"
        style={{ width: `${width}%`, opacity }}
      />
    </div>
  );
}
