import { useState } from "react";

export function SplitDialog({
  totalPages,
  busy,
  onCancel,
  onSplit,
}: {
  totalPages: number;
  busy: boolean;
  onCancel: () => void;
  onSplit: (chunkSize: number) => void;
}) {
  const [mode, setMode] = useState<"each" | "every">("each");
  const [n, setN] = useState(2);

  const chunk = mode === "each" ? 1 : Math.max(1, n);
  const fileCount = Math.ceil(totalPages / chunk);

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Split PDF</h3>
        <p className="modal-sub">{totalPages} pages in the current document.</p>

        <label className="radio-row">
          <input
            type="radio"
            name="splitmode"
            checked={mode === "each"}
            onChange={() => setMode("each")}
          />
          <span>Each page as its own file</span>
        </label>

        <label className="radio-row">
          <input
            type="radio"
            name="splitmode"
            checked={mode === "every"}
            onChange={() => setMode("every")}
          />
          <span>Every</span>
          <input
            type="number"
            className="num-input"
            min={1}
            max={Math.max(1, totalPages)}
            value={n}
            disabled={mode !== "every"}
            onChange={(e) => setN(parseInt(e.target.value || "1", 10))}
          />
          <span>pages</span>
        </label>

        <p className="modal-note">
          Will create <strong>{fileCount}</strong> file{fileCount === 1 ? "" : "s"}{" "}
          in a folder you choose.
        </p>

        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn accent"
            onClick={() => onSplit(chunk)}
            disabled={busy}
          >
            {busy ? "Splitting…" : "Split & save…"}
          </button>
        </div>
      </div>
    </div>
  );
}
