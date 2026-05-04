import { Skeleton } from "@/components/ui/skeleton";

/**
 * Default loading state for any segment under (app) that doesn't ship
 * a more specific loading.tsx. Renders a generic page skeleton — title
 * area + a couple of stat tiles + a content block — so navigation feels
 * instantaneous even when the destination page does several DB queries.
 *
 * The top progress bar runs alongside this for the click→render gap.
 * Specific detail pages (cards/[id], loans/[id], etc.) override with
 * layout-aware skeletons.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </div>
  );
}
