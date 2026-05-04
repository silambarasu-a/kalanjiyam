"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Thin horizontal progress strip rendered just below the top bar.
 *
 * Triggered by:
 *   - Same-origin link clicks (capture-phase listener) — fires the
 *     instant the user clicks, before Next.js even starts the RSC
 *     fetch. Closes the previously-silent gap between click and the
 *     new page rendering on slow detail pages.
 *   - Any `window.fetch` call (SWR data loads, manual fetches, etc).
 *   - Pathname changes that didn't originate from a tracked click
 *     (e.g. programmatic router.push) get a short pulse fallback.
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
  // Click-driven navigations register here so the pathname-change
  // effect knows whether to call `done` (closing the click) or pulse
  // (programmatic navigation that we didn't start).
  const navStartedFromClickRef = useRef(false);
  const pathname = usePathname();

  // Stable callbacks for start/done — useCallback with empty deps so
  // every effect/listener that captures them gets the same identity.
  // setState callback form (`setX(prev => ...)`) means we don't need
  // closures over current state, and refs are mutable so reads inside
  // the callbacks always see latest values.
  const start = useCallback(() => {
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
  }, []);

  const done = useCallback(() => {
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
  }, []);

  // Patch fetch once on mount. Restored on unmount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const original = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      start();
      try {
        return await original(...args);
      } finally {
        done();
      }
    };
    return () => {
      window.fetch = original;
      if (tickRef.current) clearInterval(tickRef.current);
      if (fadeRef.current) clearTimeout(fadeRef.current);
    };
  }, [start, done]);

  // Capture-phase click listener: starts the bar at click time so the
  // user gets feedback BEFORE Next.js has fetched the new RSC payload.
  // Same-origin in-app links only — external, hash, mailto, modifier-
  // clicks, and same-page anchors all skip.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const a = target?.closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href) return;
      if (
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        href.startsWith("javascript:")
      )
        return;
      const linkTarget = a.getAttribute("target");
      if (linkTarget && linkTarget !== "_self") return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      )
        return;
      navStartedFromClickRef.current = true;
      start();
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [start]);

  // Pathname change = navigation completed. If we tracked the click,
  // close out that start. Otherwise do a short pulse so programmatic
  // navigations still get a visible cue.
  useEffect(() => {
    if (navStartedFromClickRef.current) {
      navStartedFromClickRef.current = false;
      done();
      return;
    }
    start();
    const t = setTimeout(() => done(), 400);
    return () => clearTimeout(t);
  }, [pathname, start, done]);

  // Pinned to the viewport top instead of in-flow so the bar stays
  // visible when the user has scrolled the page — otherwise on mobile,
  // tapping a Link below the fold gave zero feedback because the bar
  // was scrolled out of view above the header.
  return (
    <div
      aria-hidden
      className="fixed top-0 left-0 right-0 z-[60] h-[2.5px] w-full overflow-hidden bg-transparent pointer-events-none"
    >
      <div
        className="absolute inset-y-0 left-0 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] transition-[width,opacity] duration-200 ease-out"
        style={{ width: `${width}%`, opacity }}
      />
    </div>
  );
}
