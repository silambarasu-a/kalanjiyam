"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Edit-window override prompt.
 *
 * Every lock-guarded write (transactions, investments, gold bills,
 * attendance, closed loans) answers 423 with `{ error, canForce }` once
 * the row is past the workspace edit window or its billing cycle / loan
 * has closed. Owners and Admins may retry with `force` — a `force: true`
 * body flag on PATCH/POST, or `?force=1` on DELETE.
 *
 * Rather than dead-ending on an error toast, call sites run the request
 * through `requestWithLockOverride`. On a forceable 423 it opens this
 * confirmation dialog with the server's message and, if the user agrees,
 * re-sends the same request with force set.
 *
 * Mounted once in <Providers>. The dialog is a sibling modal, which Base
 * UI stacks above any already-open dialog without dismissing it.
 */

export type LockOverridePrompt = {
  /** The server's lock message (`body.error`). */
  message: string;
  /** Heading. Defaults to "This record is locked". */
  title?: string;
  /** Confirm button label. Defaults to "Continue anyway". */
  confirmLabel?: string;
};

export type ConfirmLockOverride = (
  prompt: LockOverridePrompt,
) => Promise<boolean>;

const LockOverrideContext = createContext<ConfirmLockOverride | null>(null);

export function LockOverrideProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Kept after close so the title/message don't flash to defaults during
  // the exit animation.
  const [prompt, setPrompt] = useState<LockOverridePrompt | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmLockOverride>((next) => {
    return new Promise<boolean>((resolve) => {
      // A second prompt while one is still open answers the first "no" so
      // its caller never hangs.
      resolverRef.current?.(false);
      resolverRef.current = resolve;
      setPrompt(next);
      setOpen(true);
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOpen(false);
    resolve?.(ok);
  }, []);

  // This dialog usually sits on top of an edit form that is itself a modal
  // dialog. Neither is nested in the other's React tree, so both treat
  // themselves as topmost and Escape would close them together — losing
  // the user's unsaved edits. Claim Escape at the capture phase while
  // open so only this prompt dismisses.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      settle(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, settle]);

  return (
    <LockOverrideContext.Provider value={confirm}>
      {children}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) settle(false);
        }}
      >
        <DialogContent className="w-[min(26rem,calc(100%-2rem))]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LockKeyhole className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              {prompt?.title ?? "This record is locked"}
            </DialogTitle>
          </DialogHeader>
          <DialogDescription>{prompt?.message}</DialogDescription>
          <p className="text-xs text-muted-foreground">
            As an Owner or Admin you can override this lock. Linked
            statements and reports are not recalculated automatically.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => settle(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => settle(true)}>
              {prompt?.confirmLabel ?? "Continue anyway"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </LockOverrideContext.Provider>
  );
}

/**
 * Returns a function that opens the override confirmation and resolves
 * `true` when the user chooses to proceed. Pair it with
 * `requestWithLockOverride` rather than calling it directly.
 */
export function useLockOverride(): ConfirmLockOverride {
  const ctx = useContext(LockOverrideContext);
  if (!ctx) {
    throw new Error("useLockOverride must be used within LockOverrideProvider");
  }
  return ctx;
}

export type LockedResponseBody = { error?: string; canForce?: boolean };

export type LockOverrideOutcome<T extends object> = {
  /** The final response — the forced retry when the user confirmed. */
  res: Response;
  /** Parsed JSON body of that response (`{}` when it had none). */
  body: T & LockedResponseBody;
  /** True when the row was locked and the user declined to override. */
  cancelled: boolean;
};

async function parseBody<T extends object>(
  res: Response,
): Promise<T & LockedResponseBody> {
  return (await res.json().catch(() => ({}))) as T & LockedResponseBody;
}

/**
 * Sends `send(false)`; on a forceable 423 asks the user via the override
 * dialog and, if confirmed, re-sends `send(true)`. The caller reads the
 * outcome's `body` instead of calling `res.json()` again — the stream has
 * already been consumed.
 *
 *   const { res, body, cancelled } = await requestWithLockOverride(
 *     (force) => fetch(`/api/x/${id}${force ? "?force=1" : ""}`, { method: "DELETE" }),
 *     confirmOverride,
 *     { confirmLabel: "Delete anyway" },
 *   );
 *   if (cancelled) return;
 *   if (!res.ok) toast.error(body.error ?? "Failed");
 */
export async function requestWithLockOverride<
  T extends object = Record<string, unknown>,
>(
  send: (force: boolean) => Promise<Response>,
  confirmOverride: ConfirmLockOverride,
  prompt: Omit<LockOverridePrompt, "message"> = {},
): Promise<LockOverrideOutcome<T>> {
  let res = await send(false);
  let body = await parseBody<T>(res);
  if (res.status === 423 && body.canForce) {
    const ok = await confirmOverride({
      ...prompt,
      message: body.error ?? "This record is locked.",
    });
    if (!ok) return { res, body, cancelled: true };
    res = await send(true);
    body = await parseBody<T>(res);
  }
  return { res, body, cancelled: false };
}
