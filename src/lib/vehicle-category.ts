/**
 * Client-side "vehicle mode" detection shared by the new-transaction and
 * edit-transaction dialogs: is the selected expense category anywhere
 * inside the "Vehicle" category tree? When true the dialogs surface the
 * vehicle picker (and, for Fuel, the fill-metadata inputs).
 *
 * Walks up the parent chain looking for a category named "Vehicle", so
 * every seeded child (Toll, Road Tax / FC / PUC, Traffic Challan / Fine,
 * …) and any user-created child under Vehicle qualifies — not just a
 * hardcoded name list.
 */

type CategoryNode = {
  id: string;
  name: string;
  parentCategoryId?: string | null;
};

// Workspaces that predate the two-level tree can still hold flat,
// unparented vehicle categories; match those by name so the picker
// doesn't vanish for them.
const LEGACY_VEHICLE_NAMES = new Set([
  "vehicle purchase",
  "vehicle service",
  "fuel",
]);

export function inVehicleCategoryTree(
  selected: CategoryNode | undefined,
  categories: CategoryNode[],
): boolean {
  if (!selected) return false;
  const byId = new Map(categories.map((c) => [c.id, c]));
  let c: CategoryNode | undefined = selected;
  for (let hops = 0; c && hops < 5; hops++) {
    if (c.name.toLowerCase() === "vehicle") return true;
    c = c.parentCategoryId ? byId.get(c.parentCategoryId) : undefined;
  }
  // Only for genuinely flat rows — a "Fuel" the user filed under some
  // other parent (e.g. Farm Operations) must respect its tree position.
  return (
    selected.parentCategoryId == null &&
    LEGACY_VEHICLE_NAMES.has(selected.name.toLowerCase())
  );
}
