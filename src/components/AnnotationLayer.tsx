import { useCallback, useState } from "react";
import type { AnnotKind, Annotation } from "../lib/pdfEdit";

/**
 * The active markup tool: "select" (edit existing markup), "note" (handled by
 * PageEditor — click to place a sticky note), or an AnnotKind to draw.
 */
export type Tool = "select" | "note" | AnnotKind;

const HILITE_OPACITY = 0.35;
const MIN_DRAG = 0.008; // ignore near-zero drags (fraction of page)
const HIT_PAD = 8; // px halo so thin shapes are still clickable/selectable

type Pt = { x: number; y: number };
type Geom = Pick<Annotation, "kind" | "color" | "width" | "points">;

function bbox(pts: Pt[]) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** The visible SVG for one annotation, in stage-pixel coordinates. */
function Shape({
  a,
  sw,
  sh,
  pxPerPt,
}: {
  a: Geom;
  sw: number;
  sh: number;
  pxPerPt: number;
}) {
  if (a.points.length < 2) return null;
  const X = (n: number) => n * sw;
  const Y = (n: number) => n * sh;
  const stroke = Math.max(1, a.width * pxPerPt);
  const line = { stroke: a.color, strokeWidth: stroke, strokeLinecap: "round" as const };
  const b = bbox(a.points);

  switch (a.kind) {
    case "highlight":
      return (
        <rect
          x={X(b.x)}
          y={Y(b.y)}
          width={X(b.w)}
          height={Y(b.h)}
          fill={a.color}
          opacity={HILITE_OPACITY}
        />
      );
    case "underline":
    case "strike": {
      const y = a.kind === "underline" ? b.y + b.h : b.y + b.h / 2;
      return <line x1={X(b.x)} y1={Y(y)} x2={X(b.x + b.w)} y2={Y(y)} {...line} />;
    }
    case "rect":
      return (
        <rect
          x={X(b.x)}
          y={Y(b.y)}
          width={X(b.w)}
          height={Y(b.h)}
          fill="none"
          {...line}
        />
      );
    case "line":
    case "arrow": {
      const [s, e] = a.points;
      const head = (() => {
        if (a.kind !== "arrow") return null;
        const dx = e.x - s.x;
        const dy = e.y - s.y;
        const len = Math.hypot(dx * sw, dy * sh) || 1;
        const ux = (dx * sw) / len;
        const uy = (dy * sh) / len;
        const hl = Math.max(8, stroke * 4);
        const cos = Math.cos(Math.PI / 7);
        const sin = Math.sin(Math.PI / 7);
        const ex = X(e.x);
        const ey = Y(e.y);
        return [
          { x: ex - hl * (ux * cos - uy * sin), y: ey - hl * (uy * cos + ux * sin) },
          { x: ex - hl * (ux * cos + uy * sin), y: ey - hl * (uy * cos - ux * sin) },
        ];
      })();
      return (
        <g>
          <line x1={X(s.x)} y1={Y(s.y)} x2={X(e.x)} y2={Y(e.y)} {...line} />
          {head && (
            <>
              <line x1={X(e.x)} y1={Y(e.y)} x2={head[0].x} y2={head[0].y} {...line} />
              <line x1={X(e.x)} y1={Y(e.y)} x2={head[1].x} y2={head[1].y} {...line} />
            </>
          )}
        </g>
      );
    }
    case "ink":
      return (
        <polyline
          points={a.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")}
          fill="none"
          strokeLinejoin="round"
          {...line}
        />
      );
    default:
      return null;
  }
}

/**
 * Markup overlay for the page being viewed. Renders committed annotations and,
 * when a draw tool is active, a transparent capture surface on top that turns a
 * pointer drag into a new annotation (with a live preview). In "select" mode the
 * shapes are clickable (an invisible padded box per shape) so one can be picked
 * and deleted; empty space falls through to the stamp/signature layers beneath.
 */
export function AnnotationLayer({
  pageId,
  annots,
  tool,
  color,
  width,
  pxPerPt,
  stageW,
  stageH,
  stageRef,
  selectedId,
  onSelect,
  onAdd,
  onUpdate,
}: {
  pageId: string;
  annots: Annotation[];
  tool: Tool;
  color: string;
  width: number;
  pxPerPt: number;
  stageW: number;
  stageH: number;
  stageRef: React.RefObject<HTMLDivElement | null>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (a: Omit<Annotation, "id">) => void;
  onUpdate: (id: string, patch: Partial<Annotation>) => void;
}) {
  const [draft, setDraft] = useState<Pt[] | null>(null);
  // "note" is placed by PageEditor on the stage, not drawn here.
  const drawing = tool !== "select" && tool !== "note";

  // Select a markup and drag it: translate all its points by the pointer delta,
  // clamped so its bounding box stays on the page (so the shape isn't distorted).
  const beginMove = useCallback(
    (a: Annotation, e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      onSelect(a.id);
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const orig = a.points;
      const b = bbox(orig);
      const move = (ev: PointerEvent) => {
        const dx = Math.min(
          1 - b.x - b.w,
          Math.max(-b.x, (ev.clientX - startX) / rect.width),
        );
        const dy = Math.min(
          1 - b.y - b.h,
          Math.max(-b.y, (ev.clientY - startY) / rect.height),
        );
        onUpdate(a.id, {
          points: orig.map((p) => ({ x: p.x + dx, y: p.y + dy })),
        });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [onSelect, onUpdate, stageRef],
  );

  const startDraw = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 || tool === "select" || tool === "note") return;
      const kind: AnnotKind = tool;
      e.preventDefault();
      e.stopPropagation();
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const at = (ev: { clientX: number; clientY: number }): Pt => ({
        x: Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height)),
      });
      const p0 = at(e);
      const isInk = kind === "ink";
      let pts: Pt[] = isInk ? [p0] : [p0, p0];
      setDraft(pts);

      const move = (ev: PointerEvent) => {
        const p = at(ev);
        pts = isInk ? [...pts, p] : [pts[0], p];
        setDraft(pts);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        setDraft(null);
        const ok = isInk
          ? pts.length >= 2
          : Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) >= MIN_DRAG;
        if (ok) onAdd({ pageId, kind, color, width, points: pts });
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [tool, color, width, pageId, stageRef, onAdd],
  );

  if (!stageW || !stageH) return null;

  return (
    <>
      {/* Container never takes pointer events; only the per-shape hit boxes do
          (rendered in select mode), so empty space falls through to the layers
          beneath. */}
      <svg
        className="annot-render"
        width={stageW}
        height={stageH}
        style={{ pointerEvents: "none" }}
      >
        {annots.map((a) => {
          const b = bbox(a.points);
          return (
            <g key={a.id}>
              <Shape a={a} sw={stageW} sh={stageH} pxPerPt={pxPerPt} />
              {selectedId === a.id && (
                <rect
                  className="annot-selbox"
                  x={b.x * stageW - 3}
                  y={b.y * stageH - 3}
                  width={b.w * stageW + 6}
                  height={b.h * stageH + 6}
                />
              )}
              {tool === "select" && (
                <rect
                  x={b.x * stageW - HIT_PAD}
                  y={b.y * stageH - HIT_PAD}
                  width={b.w * stageW + 2 * HIT_PAD}
                  height={b.h * stageH + 2 * HIT_PAD}
                  fill="transparent"
                  style={{ pointerEvents: "all", cursor: "move" }}
                  onPointerDown={(e) => beginMove(a, e)}
                />
              )}
            </g>
          );
        })}
      </svg>

      {drawing && (
        <svg
          className="annot-capture"
          width={stageW}
          height={stageH}
          onPointerDown={startDraw}
        >
          {draft && (
            <Shape
              a={{ kind: tool as AnnotKind, color, width, points: draft }}
              sw={stageW}
              sh={stageH}
              pxPerPt={pxPerPt}
            />
          )}
        </svg>
      )}
    </>
  );
}
