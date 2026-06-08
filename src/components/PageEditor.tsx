import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "../lib/pdfjs";
import { usePageCanvas } from "../lib/usePageCanvas";
import type {
  FieldValue,
  PageItem,
  SigPlacement,
  TextStamp,
} from "../lib/pdfEdit";
import { FormField, type FieldKind, type FieldWidget } from "./FormField";
import { SignatureBox } from "./SignatureBox";
import { SignatureDialog } from "./SignatureDialog";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Subset of a pdf.js annotation we care about (its TS types are loose).
type AnyAnnotation = {
  id: string;
  subtype?: string;
  fieldName?: string;
  fieldType?: string;
  rect: number[];
  checkBox?: boolean;
  radioButton?: boolean;
  multiLine?: boolean;
  fieldValue?: string | string[] | null;
  buttonValue?: string;
  exportValue?: string;
  options?: { exportValue: string; displayValue: string }[];
};

function classify(a: AnyAnnotation): FieldKind | null {
  if (a.fieldType === "Tx") return "text";
  if (a.fieldType === "Ch") return "select";
  if (a.fieldType === "Btn") {
    if (a.checkBox) return "checkbox";
    if (a.radioButton) return "radio";
  }
  return null;
}

export function PageEditor({
  pdfFor,
  pages,
  index,
  stamps,
  signatures,
  formValues,
  onClose,
  onNavigate,
  onAddStamp,
  onUpdateStamp,
  onDeleteStamp,
  onAddSignature,
  onUpdateSignature,
  onDeleteSignature,
  onSetField,
}: {
  pdfFor: (item: PageItem) => PDFDocumentProxy | undefined;
  pages: PageItem[];
  index: number;
  stamps: TextStamp[];
  signatures: SigPlacement[];
  formValues: Record<string, FieldValue>;
  onClose: () => void;
  onNavigate: (n: number) => void;
  onAddStamp: (pageId: string) => void;
  onUpdateStamp: (id: string, patch: Partial<TextStamp>) => void;
  onDeleteStamp: (id: string) => void;
  onAddSignature: (pageId: string, dataUrl: string) => void;
  onUpdateSignature: (id: string, patch: Partial<SigPlacement>) => void;
  onDeleteSignature: (id: string) => void;
  onSetField: (name: string, value: FieldValue) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [stageW, setStageW] = useState(0);
  const [stageH, setStageH] = useState(0);
  const [pagePtW, setPagePtW] = useState(0);
  const [fields, setFields] = useState<FieldWidget[]>([]);
  const [showSig, setShowSig] = useState(false);

  const item = pages[index];
  const pdf = pdfFor(item);
  const pageStamps = stamps.filter((s) => s.pageId === item.id);
  const pageSigs = signatures.filter((s) => s.pageId === item.id);

  const goPrev = useCallback(() => {
    if (index > 0) onNavigate(index - 1);
  }, [index, onNavigate]);
  const goNext = useCallback(() => {
    if (index < pages.length - 1) onNavigate(index + 1);
  }, [index, pages.length, onNavigate]);

  // Keyboard: arrows navigate (unless typing); Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT");
      if (e.key === "Escape") onClose();
      else if (!typing && e.key === "ArrowLeft") goPrev();
      else if (!typing && e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goPrev, goNext]);

  usePageCanvas(
    canvasRef,
    pdf as PDFDocumentProxy,
    item.srcIndex,
    item.rotation,
    { mode: "fit", padW: 160, padH: 150 },
    setReady,
  );

  // Once rendered, measure the displayed canvas width and the displayed page
  // width in points so we can scale stamp font sizes accurately.
  useEffect(() => {
    if (!ready || !pdf) return;
    const el = stageRef.current;
    if (el) {
      setStageW(el.clientWidth);
      setStageH(el.clientHeight);
    }
    let cancelled = false;
    pdf.getPage(item.srcIndex + 1).then((page) => {
      if (cancelled) return;
      const total = (page.rotate + item.rotation) % 360;
      const vp = page.getViewport({ scale: 1, rotation: total });
      setPagePtW(vp.width);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, pdf, item.srcIndex, item.rotation]);

  // Detect interactive form fields on this page and map them to normalized rects.
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    (async () => {
      const page = await pdf.getPage(item.srcIndex + 1);
      const total = (page.rotate + item.rotation) % 360;
      const vp = page.getViewport({ scale: 1, rotation: total });
      const anns = await page.getAnnotations();
      if (cancelled) return;
      const widgets: FieldWidget[] = [];
      for (const a of anns as unknown as AnyAnnotation[]) {
        if (a.subtype !== "Widget" || !a.fieldName) continue;
        const kind = classify(a);
        if (!kind) continue;
        const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
        const ev = a.buttonValue ?? a.exportValue;
        let initial: FieldValue = "";
        if (kind === "checkbox") initial = !!(a.fieldValue && a.fieldValue !== "Off");
        else if (kind === "radio") initial = a.fieldValue === ev;
        else initial = typeof a.fieldValue === "string" ? a.fieldValue : "";
        widgets.push({
          key: a.id,
          name: a.fieldName,
          kind,
          left: Math.min(x1, x2) / vp.width,
          top: Math.min(y1, y2) / vp.height,
          width: Math.abs(x2 - x1) / vp.width,
          height: Math.abs(y2 - y1) / vp.height,
          multiline: a.multiLine,
          options: a.options?.map((o) => o.exportValue ?? o.displayValue),
          exportValue: ev,
          initial,
        });
      }
      setFields(widgets);
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, item.srcIndex, item.rotation]);

  const pxPerPt = stageW && pagePtW ? stageW / pagePtW : 1;

  return (
    <>
      <div className="viewer editor" onClick={onClose}>
      <div className="viewer-bar" onClick={(e) => e.stopPropagation()}>
        <span className="viewer-page">
          Page {index + 1} / {pages.length}
        </span>
        <div className="viewer-bar-actions">
          <button
            className="btn accent"
            onClick={() => onAddStamp(item.id)}
            title="Add a text box to this page"
          >
            + Add text
          </button>
          <button
            className="btn"
            onClick={() => setShowSig(true)}
            title="Add a signature to this page"
          >
            + Signature
          </button>
          <button className="btn" onClick={onClose}>
            Close ✕
          </button>
        </div>
      </div>

      <button
        className="viewer-nav left"
        onClick={(e) => {
          e.stopPropagation();
          goPrev();
        }}
        disabled={index <= 0}
        aria-label="Previous page"
      >
        ‹
      </button>

      <div className="viewer-stage" onClick={(e) => e.stopPropagation()}>
        <div className="editor-stage" ref={stageRef}>
          <canvas ref={canvasRef} className={ready ? "ready" : ""} />
          <div className="form-layer">
            {fields.map((f) => (
              <FormField
                key={f.key}
                field={f}
                value={formValues[f.name]}
                stageHpx={stageH}
                onChange={onSetField}
              />
            ))}
          </div>
          <div className="sig-layer">
            {pageSigs.map((s) => (
              <SignatureBox
                key={s.id}
                sig={s}
                stageRef={stageRef}
                onUpdate={onUpdateSignature}
                onDelete={onDeleteSignature}
              />
            ))}
          </div>
          <div className="stamp-layer">
            {pageStamps.map((s) => (
              <StampBox
                key={s.id}
                stamp={s}
                pxPerPt={pxPerPt}
                stageRef={stageRef}
                onUpdate={onUpdateStamp}
                onDelete={onDeleteStamp}
              />
            ))}
          </div>
        </div>
      </div>

      <button
        className="viewer-nav right"
        onClick={(e) => {
          e.stopPropagation();
          goNext();
        }}
        disabled={index >= pages.length - 1}
        aria-label="Next page"
      >
        ›
      </button>
      </div>

      {showSig && (
        <SignatureDialog
          onCancel={() => setShowSig(false)}
          onUse={(dataUrl) => {
            onAddSignature(item.id, dataUrl);
            setShowSig(false);
          }}
        />
      )}
    </>
  );
}

function StampBox({
  stamp,
  pxPerPt,
  stageRef,
  onUpdate,
  onDelete,
}: {
  stamp: TextStamp;
  pxPerPt: number;
  stageRef: React.RefObject<HTMLDivElement | null>;
  onUpdate: (id: string, patch: Partial<TextStamp>) => void;
  onDelete: (id: string) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus brand-new (empty) stamps for immediate typing.
  useEffect(() => {
    if (stamp.text === "") taRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        onUpdate(stamp.id, {
          xNorm: clamp((ev.clientX - rect.left) / rect.width, 0, 1),
          yNorm: clamp((ev.clientY - rect.top) / rect.height, 0, 0.99),
        });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [stamp.id, stageRef, onUpdate],
  );

  const bump = (delta: number) =>
    onUpdate(stamp.id, { size: clamp(stamp.size + delta, 6, 96) });

  return (
    <div
      className="stamp"
      style={{ left: `${stamp.xNorm * 100}%`, top: `${stamp.yNorm * 100}%` }}
    >
      <div className="stamp-toolbar">
        <span
          className="stamp-grip"
          onPointerDown={startDrag}
          title="Drag to move"
        >
          ⠿
        </span>
        <button className="stamp-mini" onClick={() => bump(-2)} title="Smaller">
          A−
        </button>
        <button className="stamp-mini" onClick={() => bump(2)} title="Larger">
          A+
        </button>
        <input
          type="color"
          className="stamp-color"
          value={stamp.color}
          onChange={(e) => onUpdate(stamp.id, { color: e.target.value })}
          title="Text colour"
        />
        <button
          className="stamp-mini danger"
          onClick={() => onDelete(stamp.id)}
          title="Delete text"
        >
          ✕
        </button>
      </div>
      <textarea
        ref={taRef}
        className="stamp-text"
        value={stamp.text}
        placeholder="Type…"
        spellCheck={false}
        onChange={(e) => onUpdate(stamp.id, { text: e.target.value })}
        style={{
          fontSize: `${Math.max(8, stamp.size * pxPerPt)}px`,
          color: stamp.color,
          lineHeight: 1.2,
        }}
      />
    </div>
  );
}
