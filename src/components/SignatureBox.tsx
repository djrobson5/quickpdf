import { useCallback } from "react";
import type { SigPlacement } from "../lib/pdfEdit";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function SignatureBox({
  sig,
  stageRef,
  onUpdate,
  onDelete,
}: {
  sig: SigPlacement;
  stageRef: React.RefObject<HTMLDivElement | null>;
  onUpdate: (id: string, patch: Partial<SigPlacement>) => void;
  onDelete: (id: string) => void;
}) {
  const aspect = sig.wNorm > 0 ? sig.hNorm / sig.wNorm : 1;

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        onUpdate(sig.id, {
          xNorm: clamp((ev.clientX - rect.left) / rect.width, 0, 1 - sig.wNorm),
          yNorm: clamp((ev.clientY - rect.top) / rect.height, 0, 1 - sig.hNorm),
        });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [sig.id, sig.wNorm, sig.hNorm, stageRef, onUpdate],
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
          (ev.clientX - rect.left) / rect.width - sig.xNorm,
          0.04,
          1 - sig.xNorm,
        );
        onUpdate(sig.id, { wNorm, hNorm: wNorm * aspect });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [sig.id, sig.xNorm, aspect, stageRef, onUpdate],
  );

  return (
    <div
      className="sigbox"
      style={{
        left: `${sig.xNorm * 100}%`,
        top: `${sig.yNorm * 100}%`,
        width: `${sig.wNorm * 100}%`,
        height: `${sig.hNorm * 100}%`,
      }}
    >
      <img src={sig.dataUrl} className="sigbox-img" alt="signature" draggable={false} />
      <div className="sigbox-toolbar">
        <span className="sigbox-grip" onPointerDown={startDrag} title="Drag to move">
          ⠿
        </span>
        <button
          className="sigbox-del"
          onClick={() => onDelete(sig.id)}
          title="Remove signature"
        >
          ✕
        </button>
      </div>
      <span
        className="sigbox-resize"
        onPointerDown={startResize}
        title="Drag to resize"
      />
    </div>
  );
}
