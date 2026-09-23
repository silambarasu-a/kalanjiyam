/**
 * Option text for native `<select>` / `<option>` contact pickers, which
 * can't render an icon: a leading ★ marks a favorite so the user can see
 * why the list isn't alphabetical (favorites are pinned to the top by
 * `/api/contacts`). Pickers built on NativeSelect or cmdk render a real
 * Star icon instead via their `favorite` option flag.
 */
export function contactOptionLabel(c: { name: string; favorite?: boolean }): string {
  return c.favorite ? `★ ${c.name}` : c.name;
}
