// File input/output. In the Tauri desktop app we use the native open/save
// dialogs plus small Rust commands (`read_file` / `write_file`) for efficient
// binary transfer. When running in a plain browser (e.g. `npm run dev` without
// Tauri) we transparently fall back to <input type="file"> / downloads.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

export interface LoadedFile {
  name: string;
  bytes: Uint8Array;
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/** Read a PDF from an absolute path (used when the OS opens a file with us). */
export async function readPdfPath(path: string): Promise<LoadedFile> {
  const data = await invoke<ArrayBuffer>("read_file", { path });
  return { name: baseName(path), bytes: new Uint8Array(data) };
}

/** Prompt the user to pick one or more PDFs; returns their bytes (or []). */
export async function openPdfs(): Promise<LoadedFile[]> {
  if (isTauri()) {
    const sel = await openDialog({
      multiple: true,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!sel) return [];
    const paths = Array.isArray(sel) ? sel : [sel];
    const out: LoadedFile[] = [];
    for (const p of paths) {
      const data = await invoke<ArrayBuffer>("read_file", { path: p });
      out.push({ name: baseName(p), bytes: new Uint8Array(data) });
    }
    return out;
  }
  return openPdfsBrowser();
}

/** Prompt the user to pick one or more images (PNG/JPG); returns their bytes. */
export async function openImages(): Promise<LoadedFile[]> {
  if (isTauri()) {
    const sel = await openDialog({
      multiple: true,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg"] }],
    });
    if (!sel) return [];
    const paths = Array.isArray(sel) ? sel : [sel];
    const out: LoadedFile[] = [];
    for (const p of paths) {
      const data = await invoke<ArrayBuffer>("read_file", { path: p });
      out.push({ name: baseName(p), bytes: new Uint8Array(data) });
    }
    return out;
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg";
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      const out = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          bytes: new Uint8Array(await f.arrayBuffer()),
        })),
      );
      resolve(out);
    };
    input.click();
  });
}

function openPdfsBrowser(): Promise<LoadedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      const out = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          bytes: new Uint8Array(await f.arrayBuffer()),
        })),
      );
      resolve(out);
    };
    input.click();
  });
}

/** Save bytes to disk. Returns the chosen path, or null if cancelled. */
export async function savePdf(
  bytes: Uint8Array,
  defaultName = "output.pdf",
): Promise<string | null> {
  if (isTauri()) {
    const path = await saveDialog({
      defaultPath: defaultName,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!path) return null;
    await invoke("write_file", { path, contents: Array.from(bytes) });
    return path;
  }
  triggerDownload(bytes, defaultName);
  return defaultName;
}

/** Save several files into a user-chosen folder. Returns the folder, or null. */
export async function saveMany(
  files: { name: string; bytes: Uint8Array }[],
): Promise<string | null> {
  if (isTauri()) {
    const dir = await openDialog({ directory: true, multiple: false });
    if (!dir || Array.isArray(dir)) return null;
    for (const f of files) {
      await invoke("write_file", {
        path: `${dir}/${f.name}`,
        contents: Array.from(f.bytes),
      });
    }
    return dir;
  }
  for (const f of files) triggerDownload(f.bytes, f.name);
  return "downloads";
}

function triggerDownload(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
