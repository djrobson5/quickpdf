import { useCallback, useEffect, useRef } from "react";
import type { StickyNote } from "../lib/pdfEdit";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Must match the baker (bakeNotes): 11pt text, 6pt padding, 1.3 line-height.
const FONT_PT = 11;
const PAD_PT = 6;

/**
 * An on-page sticky note: a colour-tinted card with an editable comment. Width
 * is dragged via the corner handle; height grows with the text (matching how it
 * bakes), so the saved card always shows the full comment. Drag the grip to move.
 */
export function NoteBox({
  note,
  pxPerPt,
  stageRef,
  onUpdate,
  onDelete,
}: {
  note: StickyNote;
  pxPerPt: number;
  stageRef: React.RefObject<HTMLDivElement | null>;
  onUpdate: (id: string, patch: Partial<StickyNote>) => void;
  onDelete: (id: string) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Grow the textarea to fit its content (so the card height tracks the text).
  const autosize = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useEffect(autosize, [autosize, note.text, note.wNorm, pxPerPt]);

  // Focus a brand-new (empty) note for immediate typing.
  useEffect(() => {
    if (note.text === "") taRef.current?.focus();
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
        onUpdate(note.id, {
          xNorm: clamp((ev.clientX - rect.left) / rect.width, 0, 1 - note.wNorm),
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
    [note.id, note.wNorm, stageRef, onUpdate],
  );

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        const wNorm = clamp(
          (ev.clientX - rect.left) / rect.width - note.xNorm,
          0.08,
          1 - note.xNorm,
        );
        onUpdate(note.id, { wNorm });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [note.id, note.xNorm, stageRef, onUpdate],
  );

  return (
    <div
      className="notebox"
      style={{
        left: `${note.xNorm * 100}%`,
        top: `${note.yNorm * 100}%`,
        width: `${note.wNorm * 100}%`,
        background: note.color,
      }}
    >
      <div className="notebox-bar">
        <span className="notebox-grip" onPointerDown={startDrag} title="Drag to move">
          ⠿
        </span>
        <input
          type="color"
          className="notebox-color"
          value={note.color}
          onChange={(e) => onUpdate(note.id, { color: e.target.value })}
          title="Note colour"
        />
        <button
          className="notebox-del"
          onClick={() => onDelete(note.id)}
          title="Delete note"
        >
          ✕
        </button>
      </div>
      <textarea
        ref={taRef}
        className="notebox-text"
        value={note.text}
        placeholder="Comment…"
        spellCheck={false}
        onChange={(e) => onUpdate(note.id, { text: e.target.value })}
        onInput={autosize}
        style={{
          fontSize: `${Math.max(8, FONT_PT * pxPerPt)}px`,
          padding: `${Math.max(2, PAD_PT * pxPerPt)}px`,
          lineHeight: 1.3,
        }}
      />
      <span className="notebox-resize" onPointerDown={startResize} title="Drag to resize" />
    </div>
  );
}
