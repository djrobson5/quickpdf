// Recently-opened files, persisted in localStorage (survives app restarts in
// the WebView2 origin). Only files opened from a real path get recorded, so
// this is effectively a Tauri-only convenience.

export interface RecentFile {
  path: string;
  name: string;
}

const KEY = "quickpdf:recents";
const MAX = 8;

export function getRecents(): RecentFile[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(arr)
      ? arr.filter(
          (r): r is RecentFile =>
            r && typeof r.path === "string" && typeof r.name === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function save(list: RecentFile[]): RecentFile[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable; keep going */
  }
  return list;
}

/** Add (or bump to front) a recent file; returns the new list. */
export function addRecent(file: RecentFile): RecentFile[] {
  return save(
    [file, ...getRecents().filter((r) => r.path !== file.path)].slice(0, MAX),
  );
}

/** Drop one path (e.g. it no longer opens); returns the new list. */
export function removeRecent(path: string): RecentFile[] {
  return save(getRecents().filter((r) => r.path !== path));
}
