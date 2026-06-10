import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  type SortingStrategy,
} from "@dnd-kit/sortable";
import { loadPdfDocument, type PDFDocumentProxy } from "./lib/pdfjs";
import {
  openPdfs,
  openImages,
  savePdf,
  saveMany,
  readPdfPath,
  writePdfPath,
  type LoadedFile,
} from "./lib/io";
import {
  buildPdf,
  splitPdf,
  imageToPdfPage,
  blankPdfPage,
  initialPages,
  type PageItem,
  type TextStamp,
  type BakedLine,
  type BakedImage,
  type FieldValue,
  type SigPlacement,
  type Annotation,
  type BakedAnnot,
  type StickyNote,
  type BakedNote,
} from "./lib/pdfEdit";
import { dataUrlToBytes, imageSize } from "./lib/signatures";
import {
  getRecents,
  addRecent,
  removeRecent,
  type RecentFile,
} from "./lib/recents";
import {
  GROUP_COLORS,
  groupColor as resolveGroupColor,
  groupDefaultName,
} from "./lib/groups";
import { SortablePage } from "./components/SortablePage";
import { DragPreview } from "./components/DragPreview";
import { PageEditor } from "./components/PageEditor";
import { SplitDialog } from "./components/SplitDialog";
import { GroupLegend } from "./components/GroupLegend";
import logoUrl from "./assets/quickpdf-logo.svg";
import "./App.css";

interface SourceDoc {
  id: string;
  name: string;
  bytes: Uint8Array;
  pdf: PDFDocumentProxy;
  numPages: number;
  /** Absolute path it was opened from (Tauri) — enables Save-in-place. */
  path?: string;
}

export default function App() {
  const [sources, setSources] = useState<SourceDoc[]>([]);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [stamps, setStamps] = useState<TextStamp[]>([]);
  const [sigs, setSigs] = useState<SigPlacement[]>([]);
  const [annots, setAnnots] = useState<Annotation[]>([]);
  const [notes, setNotes] = useState<StickyNote[]>([]);
  const [thumbSize, setThumbSize] = useState(190); // page-grid thumbnail width (px)
  const [recents, setRecents] = useState<RecentFile[]>(() => getRecents());
  const [update, setUpdate] = useState<Update | null>(null);
  const [updating, setUpdating] = useState(false);
  const [formValues, setFormValues] = useState<
    Record<string, Record<string, FieldValue>>
  >({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [groupNames, setGroupNames] = useState<Record<string, string>>({});
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  // True for the duration of a drag that moves a multi-page selection. A ref so
  // the (stable) sorting strategy can read it without re-subscribing mid-drag.
  const multiDragRef = useRef(false);
  // Where a multi-page block will land: the page to mark, and which edge.
  const [dropIndicator, setDropIndicator] = useState<{
    id: string;
    before: boolean;
  } | null>(null);
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
      path: file.path,
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
        setGroupNames({});
        // Fresh document: drop any overlays from a previous one (their page ids
        // are now orphaned anyway).
        setStamps([]);
        setSigs([]);
        setAnnots([]);
        setNotes([]);
        setFormValues({});
        setDirty(files.length > 1);
        let touched = false;
        for (const f of files)
          if (f.path) {
            addRecent({ path: f.path, name: f.name });
            touched = true;
          }
        if (touched) setRecents(getRecents());
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

  // Reopen a file from the recents list (drop it if it no longer opens).
  const openRecent = useCallback(
    async (path: string) => {
      try {
        await loadAsNew([await readPdfPath(path)]);
      } catch (e) {
        setError(`Could not open (moved or deleted?): ${String(e)}`);
        setRecents(removeRecent(path));
      }
    },
    [loadAsNew],
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

  // ----- Annotations (markup & drawing) -----
  const addAnnot = useCallback((a: Omit<Annotation, "id">) => {
    setAnnots((prev) => [...prev, { ...a, id: crypto.randomUUID() }]);
    setDirty(true);
  }, []);

  const updateAnnot = useCallback((id: string, patch: Partial<Annotation>) => {
    setAnnots((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    setDirty(true);
  }, []);

  const deleteAnnot = useCallback((id: string) => {
    setAnnots((prev) => prev.filter((a) => a.id !== id));
    setDirty(true);
  }, []);

  // Resolve normalized annotation points into PDF user space — one viewport
  // transform per point, so page /Rotate is handled exactly (same as stamps).
  const bakeAnnots = useCallback(async (): Promise<Map<string, BakedAnnot[]>> => {
    type VP = {
      width: number;
      height: number;
      convertToPdfPoint: (x: number, y: number) => number[];
    };
    const out = new Map<string, BakedAnnot[]>();
    const vpCache = new Map<string, VP>();
    for (const a of annots) {
      if (a.points.length < 2) continue;
      const item = pageById.get(a.pageId);
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
      // Underline/strike are a line on a dragged band. Resolve that line in
      // (rotation-aware) display space first — "bottom"/"middle" only make sense
      // there — then convert its endpoints, so it bakes correctly on /Rotate
      // pages. Every other kind just converts its raw points (a straight segment
      // between two correctly-placed points is rotation-agnostic).
      let src2 = a.points;
      if (a.kind === "underline" || a.kind === "strike") {
        const xs = a.points.map((p) => p.x);
        const ys = a.points.map((p) => p.y);
        const xLo = Math.min(...xs);
        const xHi = Math.max(...xs);
        const yLo = Math.min(...ys);
        const yHi = Math.max(...ys);
        const y = a.kind === "underline" ? yHi : (yLo + yHi) / 2; // bottom = larger y
        src2 = [
          { x: xLo, y },
          { x: xHi, y },
        ];
      }
      const pts = src2.map((p) => {
        const [px, py] = vp.convertToPdfPoint(p.x * vp.width, p.y * vp.height);
        return { x: px, y: py };
      });
      const arr = out.get(a.pageId) ?? [];
      arr.push({ kind: a.kind, color: a.color, pts, width: a.width });
      out.set(a.pageId, arr);
    }
    return out;
  }, [annots, pageById, sourceById]);

  // ----- Sticky notes -----
  const addNote = useCallback((pageId: string, xNorm: number, yNorm: number) => {
    setNotes((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        pageId,
        xNorm,
        yNorm,
        wNorm: 0.22,
        text: "",
        color: "#ffe27a",
      },
    ]);
    setDirty(true);
  }, []);

  const updateNote = useCallback((id: string, patch: Partial<StickyNote>) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    setDirty(true);
  }, []);

  const deleteNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    setDirty(true);
  }, []);

  // Resolve sticky notes for baking: wrap the text to the card width (measured
  // with a canvas, ~Helvetica), size the card to the wrapped lines, then map the
  // background corners + each text line to PDF space (rotation-exact, per point).
  const bakeNotes = useCallback(async (): Promise<Map<string, BakedNote[]>> => {
    type VP = {
      width: number;
      height: number;
      convertToPdfPoint: (x: number, y: number) => number[];
    };
    const out = new Map<string, BakedNote[]>();
    const vpCache = new Map<string, VP>();
    const ctx = document.createElement("canvas").getContext("2d");
    const FS = 11;
    const PAD = 6;
    const LH = FS * 1.3;
    const TEXT_COLOR = "#202020";
    for (const n of notes) {
      const item = pageById.get(n.pageId);
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
      const Wv = n.wNorm * vp.width;
      const innerW = Math.max(8, Wv - 2 * PAD);
      if (ctx) ctx.font = `${FS}px Helvetica, Arial, sans-serif`;
      const measure = (s: string) =>
        ctx ? ctx.measureText(s).width : s.length * FS * 0.5;

      // Greedy word-wrap, preserving explicit newlines.
      const wrapped: string[] = [];
      for (const para of n.text.split("\n")) {
        const words = para.split(/\s+/).filter(Boolean);
        if (!words.length) {
          wrapped.push("");
          continue;
        }
        let line = "";
        for (const w of words) {
          const test = line ? `${line} ${w}` : w;
          if (measure(test) <= innerW || !line) line = test;
          else {
            wrapped.push(line);
            line = w;
          }
        }
        wrapped.push(line);
      }
      if (!wrapped.length) wrapped.push("");

      const vx0 = n.xNorm * vp.width;
      const vy0 = n.yNorm * vp.height;
      const cardH = 2 * PAD + wrapped.length * LH;
      const [tlx, tly] = vp.convertToPdfPoint(vx0, vy0);
      const [brx, bry] = vp.convertToPdfPoint(vx0 + Wv, vy0 + cardH);

      const lines: BakedLine[] = [];
      wrapped.forEach((text, i) => {
        if (!text) return;
        const vx = vx0 + PAD;
        const vy = vy0 + PAD + i * LH + FS * 0.82;
        const [ax, ay] = vp.convertToPdfPoint(vx, vy);
        const [bx, by] = vp.convertToPdfPoint(vx + 10, vy);
        const rotationDeg = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
        lines.push({ x: ax, y: ay, size: FS, color: TEXT_COLOR, rotationDeg, text });
      });

      const arr = out.get(n.pageId) ?? [];
      arr.push({
        x: Math.min(tlx, brx),
        y: Math.min(tly, bry),
        width: Math.abs(brx - tlx),
        height: Math.abs(bry - tly),
        color: n.color,
        lines,
      });
      out.set(n.pageId, arr);
    }
    return out;
  }, [notes, pageById, sourceById]);

  const onDragStart = useCallback(
    (e: DragStartEvent) => {
      const activeId = String(e.active.id);
      multiDragRef.current = selected.has(activeId) && selected.size > 1;
      setActiveDragId(activeId);
    },
    [selected],
  );

  const endDrag = useCallback(() => {
    multiDragRef.current = false;
    setActiveDragId(null);
    setDropIndicator(null);
  }, []);

  // While a multi-page block is being dragged, mark where it will be inserted.
  // (For single-page drags the normal dnd-kit gap preview already shows this.)
  const onDragOver = useCallback(
    (e: DragOverEvent) => {
      if (!multiDragRef.current) return;
      const over = e.over;
      if (!over) return setDropIndicator(null);
      const overId = String(over.id);
      if (selected.has(overId)) return setDropIndicator(null);
      const activeIndex = pages.findIndex((p) => p.id === String(e.active.id));
      const overIndex = pages.findIndex((p) => p.id === overId);
      if (activeIndex < 0 || overIndex < 0) return setDropIndicator(null);
      // Dragging down inserts after the target; up inserts before it.
      setDropIndicator({ id: overId, before: activeIndex >= overIndex });
    },
    [selected, pages],
  );

  // Freeze sibling shuffling during a multi-drag — a single-item gap would
  // misrepresent a block move; the insertion bar shows the landing spot instead.
  const sortStrategy = useCallback<SortingStrategy>(
    (args) => (multiDragRef.current ? null : rectSortingStrategy(args)),
    [],
  );

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const multi = multiDragRef.current;
      endDrag();
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const activeId = String(active.id);
      const overId = String(over.id);
      setPages((prev) => {
        if (!multi) {
          const from = prev.findIndex((p) => p.id === activeId);
          const to = prev.findIndex((p) => p.id === overId);
          if (from < 0 || to < 0) return prev;
          return arrayMove(prev, from, to);
        }
        const activeIndex = prev.findIndex((p) => p.id === activeId);
        const overIndex = prev.findIndex((p) => p.id === overId);
        if (activeIndex < 0 || overIndex < 0) return prev;
        const moving = prev.filter((p) => selected.has(p.id));
        const rest = prev.filter((p) => !selected.has(p.id));
        let insertIndex: number;
        if (selected.has(overId)) {
          // Dropped onto another selected page: gather the block at that spot.
          insertIndex = rest.filter((p) => prev.indexOf(p) < overIndex).length;
        } else {
          const overInRest = rest.findIndex((p) => p.id === overId);
          insertIndex = activeIndex < overIndex ? overInRest + 1 : overInRest;
        }
        return [
          ...rest.slice(0, insertIndex),
          ...moving,
          ...rest.slice(insertIndex),
        ];
      });
      setDirty(true);
    },
    [selected, endDrag],
  );

  const resetPages = useCallback(() => {
    setPages(sources.flatMap((s) => initialPages(s.id, s.numPages)));
    setStamps([]);
    setSigs([]);
    setAnnots([]);
    setNotes([]);
    setFormValues({});
    setSelected(new Set());
    setGroupNames({});
    setDirty(false);
    flash("Reverted to the original order.");
  }, [sources, flash]);

  // ----- Selection -----
  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(
    () => setSelected(new Set(pages.map((p) => p.id))),
    [pages],
  );
  const clearSelect = useCallback(() => setSelected(new Set()), []);

  // Rubber-band (marquee) selection. Press on empty grid space and drag a box;
  // every page the box touches gets highlighted live. A plain drag replaces the
  // selection (and a plain click on empty space clears it); holding Ctrl/⌘ adds
  // to whatever was already selected. Pressing on a page itself is left alone so
  // dnd-kit can still reorder.
  const startMarquee = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return; // left button only
      const target = e.target as HTMLElement;
      if (target.closest(".thumb")) return; // thumbnails own drag + click
      const x0 = e.clientX;
      const y0 = e.clientY;
      const base =
        e.ctrlKey || e.metaKey ? new Set(selected) : new Set<string>();
      setSelected(base); // pressing empty space clears, unless Ctrl is held
      setMarquee({ x0, y0, x1: x0, y1: y0 });

      // Select every thumbnail whose box intersects the drawn rectangle.
      const hitTest = (bx: number, by: number) => {
        const left = Math.min(x0, bx);
        const right = Math.max(x0, bx);
        const top = Math.min(y0, by);
        const bottom = Math.max(y0, by);
        const next = new Set(base);
        gridRef.current
          ?.querySelectorAll<HTMLElement>(".thumb[data-page-id]")
          .forEach((node) => {
            const r = node.getBoundingClientRect();
            const hit =
              r.left < right && r.right > left && r.top < bottom && r.bottom > top;
            if (hit && node.dataset.pageId) next.add(node.dataset.pageId);
          });
        setSelected(next);
      };

      const onMove = (ev: PointerEvent) => {
        ev.preventDefault();
        setMarquee({ x0, y0, x1: ev.clientX, y1: ev.clientY });
        hitTest(ev.clientX, ev.clientY);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setMarquee(null);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [selected],
  );

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
    setAnnots((prev) => prev.filter((a) => !selected.has(a.pageId)));
    setNotes((prev) => prev.filter((n) => !selected.has(n.pageId)));
    setSelected(new Set());
    setDirty(true);
  }, [selected, pages.length, flash]);

  // Duplicate each selected page in place (right after its original), carrying
  // its overlays (stamps/signatures/markup/notes) onto the copy.
  const duplicateSelected = useCallback(() => {
    if (!selected.size) return;
    const idMap = new Map<string, string>();
    const next: PageItem[] = [];
    for (const p of pages) {
      next.push(p);
      if (selected.has(p.id)) {
        const nid = crypto.randomUUID();
        idMap.set(p.id, nid);
        next.push({ ...p, id: nid });
      }
    }
    const cloneOnto = <T extends { id: string; pageId: string }>(arr: T[]): T[] =>
      arr.flatMap((o) => {
        const nid = idMap.get(o.pageId);
        return nid
          ? [o, { ...o, id: crypto.randomUUID(), pageId: nid }]
          : [o];
      });
    setPages(next);
    setStamps(cloneOnto);
    setSigs(cloneOnto);
    setAnnots(cloneOnto);
    setNotes(cloneOnto);
    setDirty(true);
    flash(`Duplicated ${selected.size} page${selected.size === 1 ? "" : "s"}.`);
  }, [pages, selected, flash]);

  // Insert a blank page after the last selected page (or at the end).
  const insertBlankPage = useCallback(async () => {
    try {
      const src = await makeSource({ name: "Blank", bytes: await blankPdfPage() });
      const blank = initialPages(src.id, 1)[0];
      setSources((prev) => [...prev, src]);
      setPages((prev) => {
        let at = prev.length;
        prev.forEach((p, i) => {
          if (selected.has(p.id)) at = i + 1;
        });
        const next = [...prev];
        next.splice(at, 0, blank);
        return next;
      });
      setDirty(true);
      flash("Inserted a blank page.");
    } catch (e) {
      setError(`Could not insert page: ${String(e)}`);
    }
  }, [makeSource, selected, flash]);

  // ----- Page groups (color tags; purely an organizing aid) -----
  // Active groups, in palette order, with their live page counts and labels.
  const groupsInUse = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of pages)
      if (p.group) counts.set(p.group, (counts.get(p.group) ?? 0) + 1);
    return GROUP_COLORS.filter((g) => counts.has(g.id)).map((g) => ({
      id: g.id,
      color: g.color,
      label: groupNames[g.id] ?? g.name,
      count: counts.get(g.id) ?? 0,
    }));
  }, [pages, groupNames]);

  // The group shared by *every* selected page (so the swatch can show it as
  // active), or null if the selection is mixed/ungrouped.
  const selectedGroupId = useMemo(() => {
    let g: string | null | undefined;
    for (const p of pages) {
      if (!selected.has(p.id)) continue;
      const pg = p.group ?? null;
      if (g === undefined) g = pg;
      else if (g !== pg) return null;
    }
    return g ?? null;
  }, [pages, selected]);

  // Tag (or, with null, untag) the selected pages. Doesn't touch page order or
  // the saved PDF, so it deliberately doesn't mark the doc dirty.
  const assignGroup = useCallback(
    (groupId: string | null) => {
      setPages((prev) =>
        prev.map((p) =>
          selected.has(p.id) ? { ...p, group: groupId ?? undefined } : p,
        ),
      );
    },
    [selected],
  );

  const clearGroup = useCallback((groupId: string) => {
    setPages((prev) =>
      prev.map((p) => (p.group === groupId ? { ...p, group: undefined } : p)),
    );
  }, []);

  const renameGroup = useCallback((groupId: string, name: string) => {
    setGroupNames((prev) => {
      const next = { ...prev };
      const trimmed = name.trim();
      if (trimmed) next[groupId] = trimmed;
      else delete next[groupId];
      return next;
    });
  }, []);

  const selectGroup = useCallback(
    (groupId: string) =>
      setSelected(
        new Set(pages.filter((p) => p.group === groupId).map((p) => p.id)),
      ),
    [pages],
  );

  // Move a whole group while keeping the pages' relative order: "gather" pulls
  // scattered pages into one block where the group currently starts; "top"/
  // "bottom" send the block to either end.
  const reorderGroup = useCallback(
    (groupId: string, mode: "gather" | "top" | "bottom") => {
      setPages((prev) => {
        const inGroup = prev.filter((p) => p.group === groupId);
        if (!inGroup.length) return prev;
        const rest = prev.filter((p) => p.group !== groupId);
        if (mode === "top") return [...inGroup, ...rest];
        if (mode === "bottom") return [...rest, ...inGroup];
        const firstIdx = prev.findIndex((p) => p.group === groupId);
        const before = prev.slice(0, firstIdx); // contains no group pages
        const after = prev.slice(firstIdx).filter((p) => p.group !== groupId);
        return [...before, ...inGroup, ...after];
      });
      setDirty(true);
    },
    [],
  );

  // ----- Save / Extract / Split -----
  // Save-in-place target: only when a single file is open and we know its path
  // (a merged doc or a browser session has none → Save As).
  const savePath = sources.length === 1 ? sources[0].path ?? null : null;

  const handleSave = useCallback(async () => {
    if (!pages.length) return;
    setBusy(true);
    setError(null);
    try {
      const baked = await bakeStamps();
      const sigMap = await bakeSignatures();
      const annotMap = await bakeAnnots();
      const noteMap = await bakeNotes();
      const bytes = await buildPdf(bytesById, pages, baked, formMap, sigMap, annotMap, noteMap);
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
  }, [pages, bytesById, bakeStamps, bakeSignatures, bakeAnnots, bakeNotes, formMap, baseName, flash]);

  // Overwrite the original file in place (only when a single file is open and
  // we know its path); otherwise fall back to Save As.
  const handleSaveInPlace = useCallback(async () => {
    if (!savePath) return handleSave();
    if (!pages.length) return;
    setBusy(true);
    setError(null);
    try {
      const baked = await bakeStamps();
      const sigMap = await bakeSignatures();
      const annotMap = await bakeAnnots();
      const noteMap = await bakeNotes();
      const bytes = await buildPdf(bytesById, pages, baked, formMap, sigMap, annotMap, noteMap);
      await writePdfPath(savePath, bytes);
      setDirty(false);
      flash("Saved.");
    } catch (e) {
      setError(`Save failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [savePath, pages, bytesById, bakeStamps, bakeSignatures, bakeAnnots, bakeNotes, formMap, handleSave, flash]);

  const extractSelected = useCallback(async () => {
    const chosen = pages.filter((p) => selected.has(p.id));
    if (!chosen.length) return;
    setBusy(true);
    setError(null);
    try {
      const baked = await bakeStamps();
      const sigMap = await bakeSignatures();
      const annotMap = await bakeAnnots();
      const noteMap = await bakeNotes();
      const bytes = await buildPdf(bytesById, chosen, baked, formMap, sigMap, annotMap, noteMap);
      const path = await savePdf(bytes, `${baseName}-extract.pdf`);
      if (path) flash(`Extracted ${chosen.length} page${chosen.length === 1 ? "" : "s"}.`);
    } catch (e) {
      setError(`Extract failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [pages, selected, bytesById, bakeStamps, bakeSignatures, bakeAnnots, bakeNotes, formMap, baseName, flash]);

  const doSplit = useCallback(
    async (chunkSize: number) => {
      setBusy(true);
      setError(null);
      try {
        const baked = await bakeStamps();
        const sigMap = await bakeSignatures();
        const annotMap = await bakeAnnots();
        const noteMap = await bakeNotes();
        const parts = await splitPdf(
          bytesById,
          pages,
          chunkSize,
          baseName,
          baked,
          formMap,
          sigMap,
          annotMap,
          noteMap,
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
    [pages, bytesById, bakeStamps, bakeSignatures, bakeAnnots, bakeNotes, formMap, baseName, flash],
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
      const annotMap = await bakeAnnots();
      const noteMap = await bakeNotes();
      const pdfBytes = await buildPdf(bytesById, chosen, baked, formMap, sigMap, annotMap, noteMap);
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
  }, [pages, selected, bytesById, bakeStamps, bakeSignatures, bakeAnnots, formMap, baseName, flash]);

  // Save one PDF per color-group (in palette order), with overlays baked in.
  const exportGroups = useCallback(async () => {
    if (!groupsInUse.length) return;
    setBusy(true);
    setError(null);
    try {
      const baked = await bakeStamps();
      const sigMap = await bakeSignatures();
      const annotMap = await bakeAnnots();
      const noteMap = await bakeNotes();
      const files: { name: string; bytes: Uint8Array }[] = [];
      for (const g of groupsInUse) {
        const groupPages = pages.filter((p) => p.group === g.id);
        if (!groupPages.length) continue;
        const bytes = await buildPdf(bytesById, groupPages, baked, formMap, sigMap, annotMap, noteMap);
        const safe =
          g.label.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || g.id;
        files.push({ name: `${baseName}-${safe}.pdf`, bytes });
      }
      const dir = await saveMany(files);
      if (dir)
        flash(`Exported ${files.length} group${files.length === 1 ? "" : "s"}.`);
    } catch (e) {
      setError(`Export failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [
    groupsInUse,
    pages,
    bytesById,
    bakeStamps,
    bakeSignatures,
    bakeAnnots,
    bakeNotes,
    formMap,
    baseName,
    flash,
  ]);

  const closeAll = useCallback(() => {
    setSources([]);
    setPages([]);
    setStamps([]);
    setSigs([]);
    setAnnots([]);
    setNotes([]);
    setFormValues({});
    setSelected(new Set());
    setGroupNames({});
    setDirty(false);
    setPreview(null);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const hasDoc = sources.length > 0;
  const selCount = selected.size;
  // When a selected page is the one being dragged, the whole selection moves;
  // this count drives the overlay pile (0 = single-page drag, no pile).
  const multiDragCount =
    activeDragId && selected.has(activeDragId) && selected.size > 1
      ? selected.size
      : 0;
  const dragPreviewItem =
    multiDragCount > 0 && activeDragId ? pageById.get(activeDragId) : undefined;
  const dragPreviewPdf = dragPreviewItem
    ? sourceById.get(dragPreviewItem.srcId)?.pdf
    : undefined;

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
        handleSaveInPlace();
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
    handleSaveInPlace,
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

  // Check GitHub for a newer release on launch (Tauri only); a banner offers to
  // install it. Fails silently when offline / before the first updater release.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    (async () => {
      try {
        const u = await check();
        if (!cancelled && u) setUpdate(u);
      } catch {
        /* offline, no release yet, or a dev build — ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const installUpdate = useCallback(async () => {
    if (!update) return;
    setUpdating(true);
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (e) {
      setError(`Update failed: ${String(e)}`);
      setUpdating(false);
    }
  }, [update]);

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
              <button
                className="btn"
                onClick={insertBlankPage}
                title="Insert a blank page (after the selection, or at the end)"
              >
                Add blank
              </button>
              {savePath ? (
                <>
                  <button
                    className="btn accent"
                    onClick={handleSaveInPlace}
                    disabled={busy}
                    title="Overwrite the original file (Ctrl+S)"
                  >
                    {busy ? "Working…" : "Save"}
                  </button>
                  <button
                    className="btn"
                    onClick={handleSave}
                    disabled={busy}
                    title="Save as a new file"
                  >
                    Save As…
                  </button>
                </>
              ) : (
                <button
                  className="btn accent"
                  onClick={handleSave}
                  disabled={busy}
                  title="Save as a new file"
                >
                  {busy ? "Working…" : "Save As…"}
                </button>
              )}
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
              <button className="btn sm" onClick={duplicateSelected} disabled={busy}>
                Duplicate
              </button>
              <button className="btn sm danger" onClick={deleteSelected} disabled={busy}>
                Delete
              </button>
              <span className="subbar-sep" />
              <span className="group-assign">
                <span className="group-assign-label">Group</span>
                {GROUP_COLORS.map((g) => (
                  <button
                    key={g.id}
                    className={`group-swatch ${
                      selectedGroupId === g.id ? "active" : ""
                    }`}
                    style={{ background: g.color }}
                    onClick={() => assignGroup(g.id)}
                    title={`Tag selection: ${groupNames[g.id] ?? g.name}`}
                    aria-label={`Group ${groupNames[g.id] ?? g.name}`}
                  />
                ))}
                <button
                  className="group-swatch clear"
                  onClick={() => assignGroup(null)}
                  title="Remove selection from its group"
                  aria-label="Ungroup"
                >
                  ✕
                </button>
              </span>
              <span className="subbar-sep" />
              <button className="btn sm" onClick={selectAll}>
                Select all
              </button>
              <button className="btn sm" onClick={clearSelect}>
                Clear
              </button>
            </>
          ) : (
            <span className="hint">
              Click a page to view · Ctrl-click or drag a box to select · tag a
              selection with a color group · drag a page to reorder
            </span>
          )}
          <label className="thumb-zoom" title="Thumbnail size">
            <span className="thumb-zoom-ico" aria-hidden>
              ▦
            </span>
            <input
              type="range"
              min={110}
              max={340}
              step={10}
              value={thumbSize}
              onChange={(e) => setThumbSize(Number(e.target.value))}
              aria-label="Thumbnail size"
            />
          </label>
        </div>
      )}

      {hasDoc && !loading && groupsInUse.length > 0 && (
        <GroupLegend
          groups={groupsInUse}
          busy={busy}
          onSelect={selectGroup}
          onRename={renameGroup}
          onReorder={reorderGroup}
          onClear={clearGroup}
          onExportAll={exportGroups}
        />
      )}

      <main className="content" onPointerDown={startMarquee}>
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
              {recents.length > 0 && (
                <div className="recents">
                  <div className="recents-title">Recent</div>
                  <ul className="recents-list">
                    {recents.map((r) => (
                      <li key={r.path} className="recent-row">
                        <button
                          className="recent-item"
                          onClick={() => openRecent(r.path)}
                          title={r.path}
                        >
                          <span className="recent-name">{r.name}</span>
                          <span className="recent-path">{r.path}</span>
                        </button>
                        <button
                          className="recent-x"
                          onClick={() => setRecents(removeRecent(r.path))}
                          title="Remove from recents"
                          aria-label="Remove from recents"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {loading && <div className="status">Loading…</div>}

        {hasDoc && !loading && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={endDrag}
          >
            <SortableContext
              items={pages.map((p) => p.id)}
              strategy={sortStrategy}
            >
              <div
                className="page-grid"
                ref={gridRef}
                style={{ "--thumb-w": `${thumbSize}px` } as React.CSSProperties}
              >
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
                      groupColor={resolveGroupColor(item.group)}
                      groupLabel={
                        item.group
                          ? groupNames[item.group] ?? groupDefaultName(item.group)
                          : undefined
                      }
                      dragGhost={
                        multiDragCount > 0 &&
                        selected.has(item.id) &&
                        item.id !== activeDragId
                      }
                      dragLifted={multiDragCount > 0 && item.id === activeDragId}
                      dropEdge={
                        dropIndicator?.id === item.id
                          ? dropIndicator.before
                            ? "left"
                            : "right"
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {dragPreviewItem && dragPreviewPdf && (
                <DragPreview
                  pdf={dragPreviewPdf}
                  item={dragPreviewItem}
                  count={multiDragCount}
                />
              )}
            </DragOverlay>
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
          annots={annots}
          notes={notes}
          formValues={formValues[pages[preview].srcId] ?? {}}
          onClose={() => setPreview(null)}
          onNavigate={(n) => setPreview(n)}
          onAddStamp={addStamp}
          onUpdateStamp={updateStamp}
          onDeleteStamp={deleteStamp}
          onAddSignature={addSignature}
          onUpdateSignature={updateSignature}
          onDeleteSignature={deleteSignature}
          onAddAnnot={addAnnot}
          onUpdateAnnot={updateAnnot}
          onDeleteAnnot={deleteAnnot}
          onAddNote={addNote}
          onUpdateNote={updateNote}
          onDeleteNote={deleteNote}
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

      {marquee &&
        (Math.abs(marquee.x1 - marquee.x0) > 2 ||
          Math.abs(marquee.y1 - marquee.y0) > 2) && (
          <div
            className="marquee"
            style={{
              left: Math.min(marquee.x0, marquee.x1),
              top: Math.min(marquee.y0, marquee.y1),
              width: Math.abs(marquee.x1 - marquee.x0),
              height: Math.abs(marquee.y1 - marquee.y0),
            }}
          />
        )}

      {update && (
        <div className="update-banner">
          <span className="update-text">Update available — v{update.version}</span>
          <button
            className="btn sm accent"
            onClick={installUpdate}
            disabled={updating}
          >
            {updating ? "Installing…" : "Install & restart"}
          </button>
          <button
            className="btn sm"
            onClick={() => setUpdate(null)}
            disabled={updating}
          >
            Later
          </button>
        </div>
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
