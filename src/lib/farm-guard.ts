import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";

/**
 * Page-level counterpart to the farm check in `getPermission`. The API routes
 * are already 403'd by `requireWorkspace`, but a direct navigation to a farm
 * URL still rendered the full page chrome and its "New …" dialogs — the POST
 * only failed once submitted. Await this from the segment's layout so the
 * whole subtree stops before rendering.
 *
 * 404 rather than a redirect: with the module off these routes genuinely do
 * not exist for the workspace, and the URL survives so it works again the
 * moment the module is switched back on.
 *
 * Scoped to the farm flag ONLY. This is deliberately not a general per-feature
 * permission guard — Members can currently reach pages their permissions would
 * hide, and 404'ing those is a separate change.
 */
export async function assertFarmEnabled(): Promise<void> {
  const session = await auth();
  // Compare against `false` explicitly: an absent flag (pre-flag JWTs) means
  // the farm is on.
  if (session?.user?.farmEnabled === false) notFound();
}
