"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

// Shared between Dialog and Sheet so a DialogHeader/DialogFooter authored
// inside one container will pin correctly inside the other (e.g. the
// transaction form renders DialogFooter, but on mobile the parent is a
// Sheet, not a Dialog).
export type OverlaySlotContextValue = {
  headerEl: HTMLDivElement | null
  footerEl: HTMLDivElement | null
}

export const OverlaySlotContext =
  React.createContext<OverlaySlotContextValue | null>(null)

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  // Accepted but ignored — DialogHeader renders its own close button.
  // Kept on the type so existing call-sites that pass it still compile.
  showCloseButton,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  void showCloseButton

  // DialogHeader / DialogFooter portal themselves into these slot divs
  // via context, so they stay pinned regardless of how deeply they're
  // nested in the children tree.
  const [headerEl, setHeaderEl] = React.useState<HTMLDivElement | null>(null)
  const [footerEl, setFooterEl] = React.useState<HTMLDivElement | null>(null)
  const slotValue = React.useMemo(
    () => ({ headerEl, footerEl }),
    [headerEl, footerEl]
  )

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100%-2rem))] max-h-[90vh] -translate-x-1/2 -translate-y-1/2 flex flex-col rounded-2xl bg-popover text-sm text-popover-foreground ring-1 ring-border shadow-[var(--shadow-popover)] duration-100 outline-none overflow-hidden data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        <div ref={setHeaderEl} data-slot="dialog-header-slot" className="shrink-0 empty:hidden" />
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-4">
          <OverlaySlotContext.Provider value={slotValue}>
            <div className="grid gap-3">{children}</div>
          </OverlaySlotContext.Provider>
        </div>
        <div ref={setFooterEl} data-slot="dialog-footer-slot" className="shrink-0 empty:hidden" />
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<"div"> & { showCloseButton?: boolean }) {
  const ctx = React.useContext(OverlaySlotContext)
  const node = (
    <div
      data-slot="dialog-header"
      className={cn(
        "flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-border/60 bg-popover",
        className
      )}
      {...props}
    >
      <div className="flex-1 min-w-0 flex flex-col gap-1">{children}</div>
      {showCloseButton && (
        <DialogPrimitive.Close
          data-slot="dialog-close"
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full shrink-0 -mr-1"
            />
          }
        >
          <XIcon className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </div>
  )
  // Outside an overlay slot context, fall back to inline rendering
  // (preserves backward compatibility for non-Dialog/Sheet usage).
  if (!ctx) return node
  // Wait one render cycle for the slot DOM to mount before portaling so
  // the header doesn't briefly flash inside the body.
  if (!ctx.headerEl) return null
  return createPortal(node, ctx.headerEl)
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  const ctx = React.useContext(OverlaySlotContext)
  const node = (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 px-4 sm:px-5 py-3 border-t border-border/60 bg-muted/30 sm:flex-row sm:justify-end sm:items-center",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
  if (!ctx) return node
  if (!ctx.footerEl) return null
  return createPortal(node, ctx.footerEl)
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
