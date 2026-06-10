import { useState } from "react";

/** Compression presets: render scale (≈DPI/72) + JPEG quality. */
export const COMPRESS_PRESETS = [
  { id: "small", label: "Smaller file", note: "~85 DPI · lowest quality", scale: 1.2, quality: 0.5 },
  { id: "balanced", label: "Balanced", note: "~120 DPI · good for email", scale: 1.7, quality: 0.68 },
  { id: "high", label: "Higher quality", note: "~165 DPI · larger file", scale: 2.3, quality: 0.82 },
] as const;

export function CompressDialog({
  pageCount,
  busy,
  onCancel,
  onCompress,
}: {
  pageCount: number;
  busy: boolean;
  onCancel: () => void;
  onCompress: (scale: number, quality: number) => void;
}) {
  const [id, setId] = useState<string>("balanced");
  const preset = COMPRESS_PRESETS.find((p) => p.id === id) ?? COMPRESS_PRESETS[1];

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Compress PDF</h3>
        <p className="modal-sub">
          Re-encodes all {pageCount} page{pageCount === 1 ? "" : "s"} as images to
          shrink the file. Best for scans — text/vector pages become images.
        </p>

        {COMPRESS_PRESETS.map((p) => (
          <label className="radio-row" key={p.id}>
            <input
              type="radio"
              name="compresspreset"
              checked={id === p.id}
              onChange={() => setId(p.id)}
            />
            <span>{p.label}</span>
            <span className="radio-note">{p.note}</span>
          </label>
        ))}

        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn accent"
            onClick={() => onCompress(preset.scale, preset.quality)}
            disabled={busy}
          >
            {busy ? "Compressing…" : "Compress & save…"}
          </button>
        </div>
      </div>
    </div>
  );
}
