import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { loadPdfDocument, type PDFDocumentProxy } from "./lib/pdfjs";
import {
  openPdfs,
  openImages,
  savePdf,
  saveMany,
  readPdfPath,
  type LoadedFile,
} from "./lib/io";
import {
  buildPdf,
  splitPdf,
  imageToPdfPage,
  initialPages,
  type PageItem,
  type TextStamp,
  type BakedLine,
  type BakedImage,
  type FieldValue,
  type SigPlacement,
} from "./lib/pdfEdit";
import { dataUrlToBytes, imageSize } from "./lib/signatures";
import { SortablePage } from "./components/SortablePage";
import { PageEditor } from "./components/PageEditor";
import { SplitDialog } from "./components/SplitDialog";
import logoUrl from "./assets/quickpdf-logo.svg";
import "./App.css";

interface SourceDoc {
  id: string;
  name: string;
  bytes: Uint8Array;
  pdf: PDFDocumentProxy;
  numPages: number;
}

export default function App() {
  const [sources, setSources] = useState<SourceDoc[]>([]);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [stamps, setStamps] = useState<TextStamp[]>([]);
  const [sigs, setSigs] = useState<SigPlacement[]>([]);
  const [formValues, setFormValues] = useState<
    Record<string, Record<string, FieldValue>>
  >({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const [showSplit, setShowSplit] = useState(false);
  const [enhance, setEnhance] = useState(false);
  const [enhanceLevel, setEnhanceLevel] = useState(1.9);

  const sourceById = useMemo(
    () => new Map(sources.map((s) => [s.id, s])),
    [sources],
  );
  const bytesById = useMemo(
    () => new Map(sources.map((s) => [s.id, s.bytes])),
    [sources],
  );
  const pageById = useMemo(
    () => new Map(pages.map((p) => [p.id, p])),
    [pages],
  );
  const formMap = useMemo(
    () => new Map(Object.entries(formValues)),
    [formValues],
  );

  // Resolve normalized stamps into per-page PDF-space lines, using pdf.js's
  // viewport so page rotation (/Rotate) is handled exactly. Async because it
  // reads pdf.js page objects.
  const bakeStamps = useCallback(async (): Promise<Map<string, BakedLine[]>> => {
    type VP = {
      width: number;
      height: number;
      convertToPdfPoint: (x: number, y: number) => number[];
    };
    const out = new Map<string, BakedLine[]>();
    const vpCache = new Map<string, VP>();
    for (const s of stamps) {
      if (!s.text.trim()) continue;
      const item = pageById.get(s.pageId);
      if (!item) continue;
      const src = sourceById.get(item.srcId);
      if (!src) continue;
      const key = `${item.srcId}:${item.srcIndex}:${item.rotation}`;
      let cached = vpCache.get(key);
      if (!cached) {
        const page = await src.pdf.getPage(item.srcIndex + 1);
        const total = (page.rotate + item.rotation) % 360;
        cached = page.getViewport({ scale: 1, rotation: total }) as unknown as VP;
        vpCache.set(key, cached);
      }
      const vp = cached;
      const lineHeight = s.size * 1.2;
      const arr = out.get(s.pageId) ?? [];
      s.text.split("\n").forEach((line, i) => {
        if (!line) return;
        const vx = s.xNorm * vp.width;
        const vy = s.yNorm * vp.height + i * lineHeight + s.size * 0.82;
        const [ax, ay] = vp.convertToPdfPoint(vx, vy);
        const [bx, by] = vp.convertToPdfPoint(vx + 10, vy);
        const rotationDeg = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
        arr.push({ x: ax, y: ay, size: s.size, color: s.color, rotationDeg, text: line });
      });
      out.set(s.pageId, arr);
    }
    return out;
  }, [stamps, pageById, sourceById]);

  const docName =
    sources.length === 0
      ? ""
      : sources.length === 1
        ? sources[0].name
        : `Merged (${sources.length} files)`;
  const baseName = (docName || "document").replace(/\.pdf$/i, "");
  const pageFilter = enhance
    ? `contrast(${enhanceLevel.toFixed(2)}) brightness(0.9)`
    : "none";

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2800);
  }, []);

  const makeSource = useCallback(async (file: LoadedFile): Promise<SourceDoc> => {
    // pdf.js may detach the buffer it reads from; give it a copy and keep the
    // pristine bytes for editing with pdf-lib.
    const pdf = await loadPdfDocument(file.bytes.slice(0)).promise;
    return {
      id: crypto.randomUUID(),
      name: file.name,
      bytes: file.bytes,
      pdf,
      numPages: pdf.numPages,
    };
  }, []);

  const loadAsNew = useCallback(
    async (files: LoadedFile[]) => {
      if (!files.length) return;
      setLoading(true);
      setError(null);
      setPreview(null);
      try {
        const srcs = await Promise.all(files.map(makeSource));
        setSources(srcs);
        setPages(srcs.flatMap((s) => initialPages(s.id, s.numPages)));
        setSelected(new Set());
        setDirty(files.length > 1);
      } catch (e) {
        setError(`Could not open: ${String(e)}`);
        setSources([]);
        setPages([]);
      } finally {
        setLoading(false);
      }
    },
    [makeSource],
  );

  const addFiles = useCallback(
    async (files: LoadedFile[]) => {
      if (!files.length) return;
      setLoading(true);
      setError(null);
      try {
        const srcs = await Promise.all(files.map(makeSource));
        const newPages = srcs.flatMap((s) => initialPages(s.id, s.numPages));
        setSources((prev) => [...prev, ...srcs]);
        setPages((prev) => [...prev, ...newPages]);
        setDirty(true);
        const added = srcs.reduce((a, s) => a + s.numPages, 0);
        flash(
          `Added ${files.length} file${files.length === 1 ? "" : "s"} (${added} pages)`,
        );
      } catch (e) {
        setError(`Could not add: ${String(e)}`);
      } finally {
        setLoading(false);
      }
    },
    [makeSource, flash],
  );

  const handleOpen = useCallback(async () => {
    try {
      await loadAsNew(await openPdfs());
    } catch (e) {
      setError(String(e));
    }
  }, [loadAsNew]);

  const handleAdd = useCallback(async () => {
    try {
      await addFiles(await openPdfs());
    } catch (e) {
      setError(String(e));
    }
  }, [addFiles]);

  // Convert image files into single-page PDFs so they merge like any PDF.
  const imagesToPdfs = useCallback(
    async (images: LoadedFile[]): Promise<LoadedFile[]> => {
      const pdfs: LoadedFile[] = [];
      for (const im of images) {
        const bytes = await imageToPdfPage(im.bytes);
        pdfs.push({ name: im.name.replace(/\.(png|jpe?g)$/i, "") + ".pdf", bytes });
      }
      return pdfs;
    },
    [],
  );

  const handleAddImage = useCallback(async () => {
    try {
      const imgs = await openImages();
      if (!imgs.length) return;
      const pdfs = await imagesToPdfs(imgs);
      if (sources.length === 0) await loadAsNew(pdfs);
      else await addFiles(pdfs);
    } catch (e) {
      setError(String(e));
    }
  }, [imagesToPdfs, sources.length, loadAsNew, addFiles]);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const all = Array.from(e.dataTransfer.files ?? []);
      const isPdf = (f: File) =>
        f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      const isImg = (f: File) =>
        f.type.startsWith("image/") || /\.(png|jpe?g)$/i.test(f.name);
      const toLoaded = (arr: File[]) =>
        Promise.all(
          arr.map(async (f) => ({
            name: f.name,
            bytes: new Uint8Array(await f.arrayBuffer()),
          })),
        );

      const loaded: LoadedFile[] = [];
      const pdfFiles = all.filter(isPdf);
      const imgFiles = all.filter((f) => isImg(f) && !isPdf(f));
      if (pdfFiles.length) loaded.push(...(await toLoaded(pdfFiles)));
      if (imgFiles.length) loaded.push(...(await imagesToPdfs(await toLoaded(imgFiles))));

      if (!loaded.length) {
        setError("Please drop PDF or image files.");
        return;
      }
      if (sources.length === 0) await loadAsNew(loaded);
      else await addFiles(loaded);
    },
    [sources.length, loadAsNew, addFiles, imagesToPdfs],
  );

  // ----- Page operations -----
  const rotatePage = useCallback((id: string) => {
    setPages((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, rotation: (p.rotation + 90) % 360 } : p,
      ),
    );
    setDirty(true);
  }, []);

  const deletePage = useCallback(
    (id: string) => {
      if (pages.length <= 1) return;
      setPages((prev) => prev.filter((p) => p.id !== id));
      setStamps((prev) => prev.filter((s) => s.pageId !== id));
      setSigs((prev) => prev.filter((s) => s.pageId !== id));
      setSelected((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
      setDirty(true);
    },
    [pages.length],
  );

  // ----- Text stamps -----
  const addStamp = useCallback((pageId: string) => {
    setStamps((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        pageId,
        xNorm: 0.12,
        yNorm: 0.12,
        text: "",
        size: 14,
        color: "#111111",
      },
    ]);
    setDirty(true);
  }, []);

  const updateStamp = useCallback((id: string, patch: Partial<TextStamp>) => {
    setStamps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    setDirty(true);
  }, []);

  const deleteStamp = useCallback((id: string) => {
    setStamps((prev) => prev.filter((s) => s.id !== id));
    setDirty(true);
  }, []);

  // ----- Form fields -----
  const setFormValue = useCallback(
    (srcId: string, name: string, value: FieldValue) => {
      setFormValues((prev) => ({
        ...prev,
        [srcId]: { ...(prev[srcId] ?? {}), [name]: value },
      }));
      setDirty(true);
    },
    [],
  );

  // ----- Signatures -----
  const addSignature = useCallback(
    async (pageId: string, dataUrl: string) => {
      const item = pageById.get(pageId);
      const src = item ? sourceById.get(item.srcId) : undefined;
      let pageAspect = 1; // displayed width / height (pt)
      if (item && src) {
        try {
          const page = await src.pdf.getPage(item.srcIndex + 1);
          const total = (page.rotate + item.rotation) % 360;
          const vp = page.getViewport({ scale: 1, rotation: total });
          pageAspect = vp.width / vp.height;
        } catch {
          /* keep default */
        }
      }
      const { w, h } = await imageSize(dataUrl);
      const wNorm = 0.3;
      const imgAspect = w > 0 ? h / w : 0.4;
      const hNorm = wNorm * pageAspect * imgAspect;
      setSigs((prev) => [
        ...prev,
        { id: crypto.randomUUID(), pageId, dataUrl, xNorm: 0.33, yNorm: 0.42, wNorm, hNorm },
      ]);
      setDirty(true);
    },
    [pageById, sourceById],
  );

  const updateSignature = useCallback(
    (id: string, patch: Partial<SigPlacement>) => {
      setSigs((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
      setDirty(true);
    },
    [],
  );

  const deleteSignature = useCallback((id: string) => {
    setSigs((prev) => prev.filter((s) => s.id !== id));
    setDirty(true);
  }, []);

  const bakeSignatures = useCallback(async (): Promise<Map<string, BakedImage[]>> => {
    type VP = {
      width: number;
      height: number;
      convertToPdfPoint: (x: number, y: number) => number[];
    };
    const out = new Map<string, BakedImage[]>();
    const vpCache = new Map<string, VP>();
    for (const s of sigs) {
      const item = pageById.get(s.pageId);
      if (!item) continue;
      const src = sourceById.get(item.srcId);
      if (!src) continue;
      const key = `${item.srcId}:${item.srcIndex}:${item.rotation}`;
      let cached = vpCache.get(key);
      if (!cached) {
        const page = await src.pdf.getPage(item.srcIndex + 1);
        const total = (page.rotate + item.rotation) % 360;
        cached = page.getViewport({ scale: 1, rotation: total }) as unknown as VP;
        vpCache.set(key, cached);
      }
      const vp = cached;
      const vxTL = s.xNorm * vp.width;
      const vyBL = s.yNorm * vp.height + s.hNorm * vp.height; // bottom edge
      const [ax, ay] = vp.convertToPdfPoint(vxTL, vyBL);
      const [bx, by] = vp.convertToPdfPoint(vxTL + 10, vyBL);
      const rotationDeg = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
      const arr = out.get(s.pageId) ?? [];
      arr.push({
        x: ax,
        y: ay,
        width: s.wNorm * vp.width,
        height: s.hNorm * vp.height,
        rotationDeg,
        png: dataUrlToBytes(s.dataUrl),
      });
      out.set(s.pageId, arr);
    }
    return out;
  }, [sigs, pageById, sourceById]);

  const onDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setPages((prev) => {
      const from = prev.findIndex((p) => p.id === active.id);
      const to = prev.findIndex((p) => p.id === over.id);
      if (from < 0 || to < 0) return prev;
      return arrayMove(prev, from, to);
    });
    setDirty(true);
  }, []);

  const resetPages = useCallback(() => {
    setPages(sources.flatMap((s) => initialPages(s.id, s.numPages)));
    setStamps([]);
    setSigs([]);
    setFormValues({});
    setSelected(new Set());
    setDirty(false);
    flash("Reverted to the original order.");
  }, [sources, flash]);

  // ----- Selection -----
  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const selectAll = useCallback(
    () => setSelected(new Set(pages.map((p) => p.id))),
    [pages],
  );
  const clearSelect = useCallback(() => setSelected(new Set()), []);

  const rotateSelected = useCallback(() => {
    setPages((prev) =>
      prev.map((p) =>
        selected.has(p.id) ? { ...p, rotation: (p.rotation + 90) % 360 } : p,
      ),
    );
    setDirty(true);
  }, [selected]);

  const deleteSelected = useCallback(() => {
    if (selected.size >= pages.length) {
      flash("Can't delete every page.");
      return;
    }
    setPages((prev) => prev.filter((p) => !selected.has(p.id)));
    setStamps((prev) => prev.filter((s) => !selected.has(s.pageId)));
    setSigs((prev) => prev.filter((s) => !selected.has(s.pageId)));
    setSelected(new Set());
    setDirty(true);
  }, [selected, pages.length, flash]);

  // ----- Save / Extract / Split -----
  const handleSave = useCallback(async () => {
    if (!pages.length) return;
    setBusy(true);
    setError(null);
    try {
      const baked = await bakeStamps();
      const sigMap = await bakeSignatures();
      const bytes = await buildPdf(bytesById, pages, baked, formMap, sigMap);
      const path = await savePdf(bytes, `${baseName}-edited.pdf`);
      if (path) {
        setDirty(false);
        flash("Saved.");
      }
    } catch (e) {
      setError(`Save failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [pages, bytesById, bakeStamps, bakeSignatures, formMap, baseName, flash]);

  const extractSelected = useCallback(async () => {
    const chosen = pages.filter((p) => selected.has(p.id));
    if (!chosen.length) return;
    setBusy(true);
    setError(null);
    try {
      const baked = await bakeStamps();
      const sigMap = await bakeSignatures();
      const bytes = await buildPdf(bytesById, chosen, baked, formMap, sigMap);
      const path = await savePdf(bytes, `${baseName}-extract.pdf`);
      if (path) flash(`Extracted ${chosen.length} page${chosen.length === 1 ? "" : "s"}.`);
    } catch (e) {
      setError(`Extract failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [pages, selected, bytesById, bakeStamps, bakeSignatures, formMap, baseName, flash]);

  const doSplit = useCallback(
    async (chunkSize: number) => {
      setBusy(true);
      setError(null);
      try {
        const baked = await bakeStamps();
        const sigMap = await bakeSignatures();
        const parts = await splitPdf(
          bytesById,
          pages,
          chunkSize,
          baseName,
          baked,
          formMap,
          sigMap,
        );
        const dir = await saveMany(parts);
        if (dir) {
          setShowSplit(false);
          flash(`Split into ${parts.length} file${parts.length === 1 ? "" : "s"}.`);
        }
      } catch (e) {
        setError(`Split failed: ${String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [pages, bytesById, bakeStamps, bakeSignatures, formMap, baseName, flash],
  );

  const exportImages = useCallback(async () => {
    const chosen = pages.filter((p) => selected.has(p.id));
    if (!chosen.length) return;
    setBusy(true);
    setError(null);
    try {
      // Render the *final* pages (overlays baked in) so exports are WYSIWYG.
      const baked = await bakeStamps();
      const sigMap = await bakeSignatures();
      const pdfBytes = await buildPdf(bytesById, chosen, baked, formMap, sigMap);
      const doc = await loadPdfDocument(pdfBytes.slice(0)).promise;
      const scale = 2;
      const files: { name: string; bytes: Uint8Array }[] = [];
      for (let i = 0; i < doc.numPages; i++) {
        const page = await doc.getPage(i + 1);
        const vp = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
        files.push({
          name: `${baseName}-p${String(i + 1).padStart(3, "0")}.png`,
          bytes: dataUrlToBytes(canvas.toDataURL("image/png")),
        });
      }
      const dir = await saveMany(files);
      if (dir) flash(`Exported ${files.length} image${files.length === 1 ? "" : "s"}.`);
    } catch (e) {
      setError(`Export failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [pages, selected, bytesById, bakeStamps, bakeSignatures, formMap, baseName, flash]);

  const closeAll = useCallback(() => {
    setSources([]);
    setPages([]);
    setStamps([]);
    setSigs([]);
    setFormValues({});
    setSelected(new Set());
    setDirty(false);
    setPreview(null);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const hasDoc = sources.length > 0;
  const selCount = selected.size;

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable);
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "o") {
        e.preventDefault();
        handleOpen();
        return;
      }
      if (!hasDoc) return;
      if (mod && k === "s") {
        e.preventDefault();
        handleSave();
        return;
      }
      if (preview !== null || typing) return; // editor handles its own keys
      if (mod && k === "a") {
        e.preventDefault();
        selectAll();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selCount > 0) {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (e.key === "Escape" && selCount > 0) clearSelect();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    hasDoc,
    preview,
    selCount,
    handleOpen,
    handleSave,
    selectAll,
    deleteSelected,
    clearSelect,
  ]);

  // File association: open a PDF passed at launch, and any opened while we're
  // already running (forwarded by the single-instance plugin via "open-file").
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const initial = await invoke<string | null>("get_launch_path");
        if (initial) await loadAsNew([await readPdfPath(initial)]);
        unlisten = await listen<string>("open-file", async (e) => {
          try {
            await loadAsNew([await readPdfPath(e.payload)]);
          } catch {
            /* ignore */
          }
        });
      } catch {
        /* command unavailable */
      }
    })();
    return () => unlisten?.();
  }, [loadAsNew]);

  return (
    <div
      className="app"
      style={{ "--page-filter": pageFilter } as React.CSSProperties}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.relatedTarget === null) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className="toolbar">
        <div className="brand">
          <img src={logoUrl} className="brand-logo" alt="" />
          <span>QuickPDF</span>
        </div>
        <div className="toolbar-actions">
          <button className="btn primary" onClick={handleOpen}>
            Open
          </button>
          {hasDoc && (
            <>
              <button className="btn" onClick={handleAdd} title="Merge in more PDFs">
                Add PDF
              </button>
              <button
                className="btn"
                onClick={handleAddImage}
                title="Insert images (PNG/JPG) as pages"
              >
                Add image
              </button>
              <button className="btn accent" onClick={handleSave} disabled={busy}>
                {busy ? "Working…" : "Save As…"}
              </button>
              <button
                className="btn"
                onClick={() => setShowSplit(true)}
                disabled={busy}
              >
                Split
              </button>
              <button className="btn" onClick={resetPages} disabled={!dirty}>
                Reset
              </button>
              <div className="enhance-group">
                <button
                  className={`btn ${enhance ? "primary" : ""}`}
                  onClick={() => setEnhance((v) => !v)}
                  title="Boost contrast for faint scans (display only)"
                >
                  Enhance
                </button>
                {enhance && (
                  <input
                    type="range"
                    className="enhance-slider"
                    min={1}
                    max={3}
                    step={0.1}
                    value={enhanceLevel}
                    onChange={(e) => setEnhanceLevel(parseFloat(e.target.value))}
                    title={`Contrast ${enhanceLevel.toFixed(1)}×`}
                  />
                )}
              </div>
              <button className="btn" onClick={closeAll}>
                Close
              </button>
            </>
          )}
        </div>
        {hasDoc && (
          <div className="doc-meta">
            {dirty && <span className="dirty-dot" title="Unsaved changes" />}
            <span className="doc-name" title={docName}>
              {docName}
            </span>
            <span className="doc-pages">
              {pages.length} page{pages.length === 1 ? "" : "s"}
            </span>
          </div>
        )}
      </header>

      {hasDoc && !loading && (
        <div className={`subbar ${selCount > 0 ? "selecting" : ""}`}>
          {selCount > 0 ? (
            <>
              <span className="sel-count">{selCount} selected</span>
              <button className="btn sm accent" onClick={extractSelected} disabled={busy}>
                Extract → new PDF
              </button>
              <button className="btn sm" onClick={exportImages} disabled={busy}>
                Export PNG
              </button>
              <button className="btn sm" onClick={rotateSelected} disabled={busy}>
                Rotate
              </button>
              <button className="btn sm danger" onClick={deleteSelected} disabled={busy}>
                Delete
              </button>
              <button className="btn sm" onClick={selectAll}>
                Select all
              </button>
              <button className="btn sm" onClick={clearSelect}>
                Clear
              </button>
            </>
          ) : (
            <span className="hint">
              Drag to reorder · hover to rotate/delete · check to select · click a
              page to view & add text
            </span>
          )}
        </div>
      )}

      <main className="content">
        {error && <div className="error">{error}</div>}

        {!hasDoc && !loading && (
          <div className={`dropzone ${dragging ? "drag" : ""}`}>
            <div className="dropzone-inner">
              <div className="dropzone-icon">▤</div>
              <h2>Open a PDF to get started</h2>
              <p>Drag PDFs or images anywhere onto this window, or use the button.</p>
              <button className="btn primary lg" onClick={handleOpen}>
                Choose PDF(s)
              </button>
            </div>
          </div>
        )}

        {loading && <div className="status">Loading…</div>}

        {hasDoc && !loading && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={pages.map((p) => p.id)}
              strategy={rectSortingStrategy}
            >
              <div className="page-grid">
                {pages.map((item, i) => {
                  const pdf = sourceById.get(item.srcId)?.pdf;
                  if (!pdf) return null;
                  return (
                    <SortablePage
                      key={item.id}
                      pdf={pdf}
                      item={item}
                      position={i + 1}
                      selected={selected.has(item.id)}
                      canDelete={pages.length > 1}
                      onOpen={() => setPreview(i)}
                      onRotate={() => rotatePage(item.id)}
                      onDelete={() => deletePage(item.id)}
                      onToggleSelect={() => toggleSelect(item.id)}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </main>

      {hasDoc && preview !== null && pages[preview] && (
        <PageEditor
          pdfFor={(it) => sourceById.get(it.srcId)?.pdf}
          pages={pages}
          index={preview}
          stamps={stamps}
          signatures={sigs}
          formValues={formValues[pages[preview].srcId] ?? {}}
          onClose={() => setPreview(null)}
          onNavigate={(n) => setPreview(n)}
          onAddStamp={addStamp}
          onUpdateStamp={updateStamp}
          onDeleteStamp={deleteStamp}
          onAddSignature={addSignature}
          onUpdateSignature={updateSignature}
          onDeleteSignature={deleteSignature}
          onSetField={(name, value) =>
            setFormValue(pages[preview].srcId, name, value)
          }
        />
      )}

      {showSplit && (
        <SplitDialog
          totalPages={pages.length}
          busy={busy}
          onCancel={() => setShowSplit(false)}
          onSplit={doSplit}
        />
      )}

      {notice && <div className="notice">{notice}</div>}

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-text">
            {hasDoc ? "Drop to merge" : "Drop PDF to open"}
          </div>
        </div>
      )}
    </div>
  );
}
