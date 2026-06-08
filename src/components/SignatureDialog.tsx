import { useEffect, useRef, useState } from "react";
import SignaturePad from "signature_pad";
import {
  fileToPngDataUrl,
  loadSavedSignatures,
  persistSavedSignatures,
  type SavedSig,
} from "../lib/signatures";

type Tab = "draw" | "upload" | "saved";

// In glide mode, a cursor jump larger than this (CSS px) between move events is
// treated as a reposition (finger lifted/moved) rather than a drawn segment.
const JUMP = 70;

export function SignatureDialog({
  onCancel,
  onUse,
}: {
  onCancel: () => void;
  onUse: (dataUrl: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("draw");
  const [saved, setSaved] = useState<SavedSig[]>(() => loadSavedSignatures());
  const [save, setSave] = useState(true);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [glide, setGlide] = useState(false);
  const [penDown, setPenDown] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const drawnRef = useRef(false);
  const penDownRef = useRef(false);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);

  // (Re)configure the drawing canvas when the Draw tab opens or glide toggles.
  // Normal mode: signature_pad (press-drag). Glide mode: the pen tracks the
  // cursor exactly — glide your finger to move it, tap to lift/lower the pen.
  useEffect(() => {
    if (tab !== "draw") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    const ctx = canvas.getContext("2d");
    ctx?.scale(ratio, ratio);

    drawnRef.current = false;
    penDownRef.current = false;
    lastPtRef.current = null;
    setPenDown(false);

    if (!glide) {
      const pad = new SignaturePad(canvas, {
        penColor: "#111111",
        backgroundColor: "rgba(0,0,0,0)",
      });
      padRef.current = pad;
      return () => {
        pad.off();
        padRef.current = null;
      };
    }

    if (!ctx) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 2.5;

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      const next = !penDownRef.current;
      penDownRef.current = next;
      setPenDown(next);
      lastPtRef.current = next ? { x: e.offsetX, y: e.offsetY } : null;
    };
    const onMove = (e: PointerEvent) => {
      if (!penDownRef.current) return;
      const p = { x: e.offsetX, y: e.offsetY };
      const last = lastPtRef.current;
      if (last) {
        const d = Math.hypot(p.x - last.x, p.y - last.y);
        if (d < JUMP) {
          ctx.beginPath();
          ctx.moveTo(last.x, last.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          drawnRef.current = true;
        }
      }
      lastPtRef.current = p;
    };
    // Leaving and re-entering the pad shouldn't draw a line across the gap.
    const onLeave = () => {
      lastPtRef.current = null;
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [tab, glide]);

  const clearPad = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!glide && padRef.current) {
      padRef.current.clear();
    } else {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
      }
    }
    drawnRef.current = false;
    penDownRef.current = false;
    lastPtRef.current = null;
    setPenDown(false);
  };

  const addToLibrary = (dataUrl: string) => {
    if (!save) return;
    const next = [{ id: crypto.randomUUID(), dataUrl }, ...saved].slice(0, 24);
    setSaved(next);
    persistSavedSignatures(next);
  };

  const useDrawn = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!glide) {
      const pad = padRef.current;
      if (!pad || pad.isEmpty()) return;
      const dataUrl = pad.toDataURL("image/png");
      addToLibrary(dataUrl);
      onUse(dataUrl);
    } else {
      if (!drawnRef.current) return;
      const dataUrl = canvas.toDataURL("image/png");
      addToLibrary(dataUrl);
      onUse(dataUrl);
    }
  };

  const useUploaded = () => {
    if (!uploaded) return;
    addToLibrary(uploaded);
    onUse(uploaded);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      setUploaded(await fileToPngDataUrl(f));
    } catch {
      setUploaded(null);
    }
  };

  const removeSaved = (id: string) => {
    const next = saved.filter((s) => s.id !== id);
    setSaved(next);
    persistSavedSignatures(next);
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal sig-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add signature</h3>
        <div className="sig-tabs">
          <button
            className={`sig-tab ${tab === "draw" ? "on" : ""}`}
            onClick={() => setTab("draw")}
          >
            Draw
          </button>
          <button
            className={`sig-tab ${tab === "upload" ? "on" : ""}`}
            onClick={() => setTab("upload")}
          >
            Upload
          </button>
          <button
            className={`sig-tab ${tab === "saved" ? "on" : ""}`}
            onClick={() => setTab("saved")}
          >
            Saved ({saved.length})
          </button>
        </div>

        {tab === "draw" && (
          <>
            <canvas
              ref={canvasRef}
              className={`sig-pad ${glide ? "glide" : ""}`}
            />
            <div className="sig-row">
              <div className="sig-left">
                <button className="btn sm" onClick={clearPad}>
                  Clear
                </button>
                <label
                  className="sig-savecheck"
                  title="The pen follows your cursor; tap the pad to lift/lower it"
                >
                  <input
                    type="checkbox"
                    checked={glide}
                    onChange={(e) => setGlide(e.target.checked)}
                  />
                  Glide mode
                </label>
                {glide && (
                  <span className="sig-pen">
                    {penDown
                      ? "Pen down — glide to draw, tap to lift"
                      : "Tap the pad to lower the pen, then glide to draw"}
                  </span>
                )}
              </div>
              <label className="sig-savecheck">
                <input
                  type="checkbox"
                  checked={save}
                  onChange={(e) => setSave(e.target.checked)}
                />
                Save to library
              </label>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={onCancel}>
                Cancel
              </button>
              <button className="btn accent" onClick={useDrawn}>
                Use signature
              </button>
            </div>
          </>
        )}

        {tab === "upload" && (
          <>
            <div className="sig-upload">
              {uploaded ? (
                <img src={uploaded} className="sig-preview" alt="signature" />
              ) : (
                <p className="modal-sub">Choose a PNG or JPG of your signature.</p>
              )}
              <input type="file" accept="image/png,image/jpeg" onChange={onFile} />
            </div>
            <div className="sig-row">
              <label className="sig-savecheck">
                <input
                  type="checkbox"
                  checked={save}
                  onChange={(e) => setSave(e.target.checked)}
                />
                Save to library
              </label>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={onCancel}>
                Cancel
              </button>
              <button className="btn accent" onClick={useUploaded} disabled={!uploaded}>
                Use signature
              </button>
            </div>
          </>
        )}

        {tab === "saved" && (
          <>
            {saved.length === 0 ? (
              <p className="modal-sub sig-empty">
                No saved signatures yet. Draw or upload one and keep “Save to
                library” checked.
              </p>
            ) : (
              <div className="sig-grid">
                {saved.map((s) => (
                  <div className="sig-cell" key={s.id}>
                    <button
                      className="sig-cell-use"
                      onClick={() => onUse(s.dataUrl)}
                      title="Use this signature"
                    >
                      <img src={s.dataUrl} alt="saved signature" />
                    </button>
                    <button
                      className="sig-cell-del"
                      onClick={() => removeSaved(s.id)}
                      title="Delete"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={onCancel}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
