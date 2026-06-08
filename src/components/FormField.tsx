import type { FieldValue } from "../lib/pdfEdit";

export type FieldKind = "text" | "checkbox" | "radio" | "select";

export interface FieldWidget {
  /** Unique per widget (annotation id). */
  key: string;
  /** Form field name (shared across a radio group's widgets). */
  name: string;
  kind: FieldKind;
  /** Normalized rect (0..1) over the displayed page. */
  left: number;
  top: number;
  width: number;
  height: number;
  multiline?: boolean;
  options?: string[];
  /** On-value for this checkbox/radio widget. */
  exportValue?: string;
  /** Initial value from the PDF (string for text/select, boolean checked state). */
  initial: FieldValue;
}

export function FormField({
  field,
  value,
  stageHpx,
  onChange,
}: {
  field: FieldWidget;
  value: FieldValue | undefined;
  stageHpx: number;
  onChange: (name: string, value: FieldValue) => void;
}) {
  const style: React.CSSProperties = {
    left: `${field.left * 100}%`,
    top: `${field.top * 100}%`,
    width: `${field.width * 100}%`,
    height: `${field.height * 100}%`,
  };
  const boxPx = field.height * stageHpx;
  const fontPx = Math.max(8, Math.min(boxPx * 0.62, 20));

  if (field.kind === "checkbox") {
    const checked = typeof value === "boolean" ? value : field.initial === true;
    return (
      <button
        className={`ff-check ${checked ? "on" : ""}`}
        style={style}
        onClick={() => onChange(field.name, !checked)}
        title={field.name}
      >
        {checked ? "✓" : ""}
      </button>
    );
  }

  if (field.kind === "radio") {
    const checked =
      typeof value === "string" ? value === field.exportValue : field.initial === true;
    return (
      <button
        className={`ff-check ff-radio ${checked ? "on" : ""}`}
        style={style}
        onClick={() => onChange(field.name, field.exportValue ?? "")}
        title={field.name}
      >
        {checked ? "●" : ""}
      </button>
    );
  }

  if (field.kind === "select") {
    const v = typeof value === "string" ? value : (field.initial as string) || "";
    return (
      <select
        className="ff-input"
        style={{ ...style, fontSize: `${fontPx}px` }}
        value={v}
        onChange={(e) => onChange(field.name, e.target.value)}
        title={field.name}
      >
        <option value=""></option>
        {field.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  const v = typeof value === "string" ? value : (field.initial as string) || "";
  if (field.multiline) {
    return (
      <textarea
        className="ff-input ff-textarea"
        style={{ ...style, fontSize: `${fontPx}px` }}
        value={v}
        spellCheck={false}
        onChange={(e) => onChange(field.name, e.target.value)}
        title={field.name}
      />
    );
  }
  return (
    <input
      className="ff-input"
      style={{ ...style, fontSize: `${fontPx}px` }}
      value={v}
      spellCheck={false}
      onChange={(e) => onChange(field.name, e.target.value)}
      title={field.name}
    />
  );
}
