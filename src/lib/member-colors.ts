/**
 * Per-member colour coding.
 *
 * A household's accounts and cards belong to different family members, and
 * every picker used to render them as a bare name — my HDFC Millennia and my
 * wife's HDFC Millennia looked identical. Each member gets a colour so the
 * owner is readable at a glance.
 *
 * "Member" here is whoever the row is attributed to, in this order:
 *   1. `ownerContact` — the Family member (Contact). This is the axis that
 *      actually varies in a household: one login, many people.
 *   2. `ownerUser` — the workspace member (User), for workspaces that really
 *      do have several logins.
 * Rows with neither read as the account holder's own and stay undecorated.
 *
 * Colours are derived from the owner id, so they need no extra column and no
 * extra fetch, and stay the same across every screen. A plain hash collides
 * too often to be useful (three members over an eight-colour palette collide
 * ~1 time in 3), so `memberColorMap` de-collides: ids are walked in sorted
 * order and each one linear-probes from its preferred slot to the first free
 * colour. Sorted order makes that deterministic — the same member set always
 * produces the same assignment.
 */

export type MemberColor = {
  /** Solid swatch — reads on both light and dark surfaces. */
  dot: string;
  /** Name text colour. */
  text: string;
  /** Soft badge (background + text) for chips. */
  chip: string;
};

export const MEMBER_COLORS: MemberColor[] = [
  {
    dot: "bg-sky-500",
    text: "text-sky-600 dark:text-sky-400",
    chip: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  },
  {
    dot: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    chip: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  },
  {
    dot: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    chip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  },
  {
    dot: "bg-violet-500",
    text: "text-violet-600 dark:text-violet-400",
    chip: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  },
  {
    dot: "bg-rose-500",
    text: "text-rose-600 dark:text-rose-400",
    chip: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
  },
  {
    dot: "bg-teal-500",
    text: "text-teal-600 dark:text-teal-400",
    chip: "bg-teal-500/12 text-teal-700 dark:text-teal-300",
  },
  {
    dot: "bg-orange-500",
    text: "text-orange-600 dark:text-orange-400",
    chip: "bg-orange-500/12 text-orange-700 dark:text-orange-300",
  },
  {
    dot: "bg-indigo-500",
    text: "text-indigo-600 dark:text-indigo-400",
    chip: "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300",
  },
];

/** djb2. Stable across runtimes — no Math.random, no Date. */
function hashId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = (h * 33 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Build the id → colour assignment for a set of members. Pass every owner
 * you want distinguishable in one go; two members in the same map never
 * share a colour (until the palette runs out, at which point it wraps).
 */
export function memberColorMap(userIds: Iterable<string>): Map<string, MemberColor> {
  const unique = Array.from(new Set(userIds)).filter(Boolean).sort();
  const taken = new Set<number>();
  const map = new Map<string, MemberColor>();
  for (const id of unique) {
    let slot = hashId(id) % MEMBER_COLORS.length;
    for (let i = 0; i < MEMBER_COLORS.length && taken.has(slot); i++) {
      slot = (slot + 1) % MEMBER_COLORS.length;
    }
    taken.add(slot);
    map.set(id, MEMBER_COLORS[slot]);
  }
  return map;
}

export type OwnedRow = {
  ownerContact?: { id: string; name: string } | null;
  ownerUser?: { id: string; name?: string | null } | null;
};

/** Who a row is attributed to — Family member first, workspace member next. */
export function rowOwner(row: OwnedRow): { id: string; name: string } | null {
  if (row.ownerContact) return row.ownerContact;
  if (row.ownerUser) return { id: row.ownerUser.id, name: row.ownerUser.name ?? "" };
  return null;
}

/**
 * Colour map for a list of owned rows (accounts / cards / loans), or
 * `undefined` when the list can't tell two members apart — a household that
 * has attributed nothing (or everything to one person) gets no decoration at
 * all rather than a pointless dot on every row.
 *
 * Pass the *unfiltered* list where you have one, and hand the result to
 * `buildFundingSourceGroups`' `ownerColors` option for any filtered picker
 * built from it, so a member keeps the same colour in every dropdown.
 */
export function memberColorsFor(rows: OwnedRow[]): Map<string, MemberColor> | undefined {
  const ids = rows.map((r) => rowOwner(r)?.id).filter((id): id is string => !!id);
  const distinct = new Set(ids);
  // One owner across the whole list is only worth colouring when some rows
  // are unattributed — then the dot means "this one is someone else's".
  if (distinct.size === 0) return undefined;
  if (distinct.size === 1 && ids.length === rows.length) return undefined;
  return memberColorMap(ids);
}

/** First name only — pickers are tight on horizontal space. */
export function shortMemberName(name?: string | null): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0];
}
