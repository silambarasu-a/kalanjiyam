"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * `<NavigatingCard>` — a Link replacement that surfaces an immediate
 * spinner overlay on click + dims the card while the next route loads.
 *
 * The global TopProgressBar already animates on every link click, but
 * for big clickable cards (vehicles, events, etc.) users expect a
 * stronger local cue — they tapped *this* card, so *this* card should
 * react.
 *
 * Implementation notes:
 *   - `useRouter().push` inside `startTransition` lets us track the
 *     pending state until the new route's RSC payload commits.
 *   - The native `<Link>` is preserved as the children so right-click
 *     "Open in new tab" and keyboard middle-click still work.
 *   - When the new page replaces this component, React unmounts it —
 *     state resets automatically; no cleanup needed.
 */
export function NavigatingCard({
  href,
  children,
  className,
  ariaLabel,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Separate "clicked" flag so the overlay shows the instant the user
  // taps, before useTransition has measured the pending state.
  const [clicked, setClicked] = useState(false);
  const loading = isPending || clicked;

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    // Honour modifier keys + middle clicks so the user can open in a
    // new tab / window without the in-page transition firing.
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return;
    }
    e.preventDefault();
    setClicked(true);
    startTransition(() => {
      router.push(href);
    });
  }

  return (
    <Link
      href={href}
      onClick={handleClick}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      className={cn(
        "group relative block transition-all",
        loading ? "pointer-events-none opacity-70" : "",
        className,
      )}
    >
      {children}
      {loading && (
        <div
          aria-hidden
          className="absolute inset-0 flex items-center justify-center rounded-[inherit] bg-background/40 backdrop-blur-[1px]"
        >
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      )}
    </Link>
  );
}
