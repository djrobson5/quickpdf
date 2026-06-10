// Page color-groups: a lightweight, session-only organizing aid. A page can
// carry an optional `group` id (see PageItem.group); these presets give each id
// a display color and default label. Groups never change the saved PDF — they
// just let the user tag, find, and move ranges of pages while rearranging.

export interface GroupDef {
  id: string;
  name: string;
  color: string;
}

// A small, visually distinct palette (kept clear of the cyan selection accent).
export const GROUP_COLORS: GroupDef[] = [
  { id: "red", name: "Red", color: "#ef4444" },
  { id: "orange", name: "Orange", color: "#f59e0b" },
  { id: "green", name: "Green", color: "#22c55e" },
  { id: "blue", name: "Blue", color: "#3b82f6" },
  { id: "purple", name: "Purple", color: "#a855f7" },
  { id: "pink", name: "Pink", color: "#ec4899" },
];

const BY_ID = new Map(GROUP_COLORS.map((g) => [g.id, g]));

/** The display color for a group id, or undefined if unknown/ungrouped. */
export function groupColor(id: string | undefined): string | undefined {
  return id ? BY_ID.get(id)?.color : undefined;
}

/** The built-in label for a group id (before any user rename). */
export function groupDefaultName(id: string): string {
  return BY_ID.get(id)?.name ?? id;
}
