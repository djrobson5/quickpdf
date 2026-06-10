import { useEffect, useRef, useState } from "react";

export interface LegendGroup {
  id: string;
  color: string;
  label: string;
  count: number;
}

/**
 * The groups bar: one chip per color-group in use. Click a chip to select all
 * its pages; hover for tools (gather together, send to top/bottom, remove);
 * double-click the name to rename. "Export each group" saves one PDF per group.
 */
export function GroupLegend({
  groups,
  busy,
  onSelect,
  onRename,
  onReorder,
  onClear,
  onExportAll,
}: {
  groups: LegendGroup[];
  busy: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onReorder: (id: string, mode: "gather" | "top" | "bottom") => void;
  onClear: (id: string) => void;
  onExportAll: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) inputRef.current?.select();
  }, [editingId]);

  const startEdit = (g: LegendGroup) => {
    setEditingId(g.id);
    setDraft(g.label);
  };
  const commit = () => {
    if (editingId) onRename(editingId, draft);
    setEditingId(null);
  };

  return (
    <div className="group-legend">
      <span className="group-legend-label">Groups</span>
      {groups.map((g) => (
        <div
          key={g.id}
          className="group-chip"
          style={{ "--group-color": g.color } as React.CSSProperties}
        >
          {editingId === g.id ? (
            <input
              ref={inputRef}
              className="group-name-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                else if (e.key === "Escape") setEditingId(null);
              }}
              maxLength={24}
            />
          ) : (
            <button
              className="group-chip-main"
              onClick={() => onSelect(g.id)}
              onDoubleClick={() => startEdit(g)}
              title={`Select all ${g.count} page${
                g.count === 1 ? "" : "s"
              } · double-click to rename`}
            >
              <span className="group-dot" />
              <span className="group-name">{g.label}</span>
              <span className="group-count">{g.count}</span>
            </button>
          )}
          <div className="group-chip-tools">
            <button
              className="group-tool"
              title="Gather these pages together"
              onClick={() => onReorder(g.id, "gather")}
            >
              ⇲
            </button>
            <button
              className="group-tool"
              title="Move group to top"
              onClick={() => onReorder(g.id, "top")}
            >
              ⤒
            </button>
            <button
              className="group-tool"
              title="Move group to bottom"
              onClick={() => onReorder(g.id, "bottom")}
            >
              ⤓
            </button>
            <button
              className="group-tool danger"
              title="Remove group (keeps the pages)"
              onClick={() => onClear(g.id)}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
      <span className="group-legend-spacer" />
      <button
        className="btn sm"
        onClick={onExportAll}
        disabled={busy}
        title="Save each group as its own PDF"
      >
        Export each group
      </button>
    </div>
  );
}
