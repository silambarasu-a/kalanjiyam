"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { OverlaySlotContext } from "@/components/ui/dialog"
import { XIcon } from "lucide-react"

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  // Accepted but ignored — SheetHeader renders its own close button.
  // Kept on the type so existing call-sites that pass it still compile.
  showCloseButton,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  void showCloseButton

  // SheetHeader / SheetFooter (and DialogHeader / DialogFooter) portal
  // into these slot divs via context, so they stay pinned regardless of
  // nesting depth in the children tree.
  const [headerEl, setHeaderEl] = React.useState<HTMLDivElement | null>(null)
  const [footerEl, setFooterEl] = React.useState<HTMLDivElement | null>(null)
  const slotValue = React.useMemo(
    () => ({ headerEl, footerEl }),
    [headerEl, footerEl]
  )

  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col bg-popover bg-clip-padding text-sm text-popover-foreground shadow-(--shadow-popover) overflow-hidden transition duration-200 ease-in-out data-ending-style:opacity-0 data-starting-style:opacity-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:max-h-[92vh] data-[side=bottom]:border-t data-[side=bottom]:rounded-t-2xl data-[side=bottom]:data-ending-style:translate-y-10 data-[side=bottom]:data-starting-style:translate-y-10 data-[side=bottom]:sm:inset-x-auto data-[side=bottom]:sm:left-1/2 data-[side=bottom]:sm:-translate-x-1/2 data-[side=bottom]:sm:bottom-4 data-[side=bottom]:sm:w-[min(32rem,calc(100%-2rem))] data-[side=bottom]:sm:rounded-2xl data-[side=bottom]:sm:border data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=left]:rounded-r-2xl data-[side=left]:data-ending-style:-translate-x-10 data-[side=left]:data-starting-style:-translate-x-10 data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=right]:rounded-l-2xl data-[side=right]:data-ending-style:translate-x-10 data-[side=right]:data-starting-style:translate-x-10 data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:max-h-[92vh] data-[side=top]:border-b data-[side=top]:rounded-b-2xl data-[side=top]:data-ending-style:-translate-y-10 data-[side=top]:data-starting-style:-translate-y-10 data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
          className
        )}
        {...props}
      >
        <div ref={setHeaderEl} data-slot="sheet-header-slot" className="shrink-0 empty:hidden" />
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-4">
          <OverlaySlotContext.Provider value={slotValue}>
            {children}
          </OverlaySlotContext.Provider>
        </div>
        <div ref={setFooterEl} data-slot="sheet-footer-slot" className="shrink-0 empty:hidden" />
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<"div"> & { showCloseButton?: boolean }) {
  const ctx = React.useContext(OverlaySlotContext)
  const node = (
    <div
      data-slot="sheet-header"
      className={cn(
        "flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-border/60 bg-popover",
        className
      )}
      {...props}
    >
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">{children}</div>
      {showCloseButton && (
        <SheetPrimitive.Close
          data-slot="sheet-close"
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
        </SheetPrimitive.Close>
      )}
    </div>
  )
  if (!ctx) return node
  if (!ctx.headerEl) return null
  return createPortal(node, ctx.headerEl)
}

function SheetFooter({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const ctx = React.useContext(OverlaySlotContext)
  const node = (
    <div
      data-slot="sheet-footer"
      className={cn(
        "flex flex-col-reverse gap-2 px-4 sm:px-5 py-3 border-t border-border/60 bg-muted/30 sm:flex-row sm:justify-end sm:items-center",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
  if (!ctx) return node
  if (!ctx.footerEl) return null
  return createPortal(node, ctx.footerEl)
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-base font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
