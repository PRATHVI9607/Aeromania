import type { ParamMeta } from "./types";
import { inr } from "./fmt";

/** Money number with a keyboard-focusable assumption tooltip: param name + source note from the JSON. */
export function Rupee({ v, name, meta, value }: { v: number; name: string; meta?: ParamMeta; value?: unknown }) {
  const f = inr(v);
  const note = `${value !== undefined ? JSON.stringify(value) + ". " : ""}${meta?.source ?? "derived from assumed parameters"}${meta && !meta.assumption ? "" : " (assumption)"}`;
  return (
    <span className="assume" tabIndex={0} role="note" aria-label={`${f}. Parameter ${name}: ${note}`}>
      {f}
      <span className="tip"><b>{name}</b>{note}</span>
    </span>
  );
}
