import type { ReactNode } from "react";
/** One-line purpose strip shown at the top of every view: who, what, decision, key result. Chips, not sentences. */
export function Purpose({ who, does, decision, result }: { who: ReactNode; does: ReactNode; decision: ReactNode; result: ReactNode }) {
  const row: [string, ReactNode][] = [["Who uses this", who], ["What you do here", does], ["Decision it supports", decision], ["Key result", result]];
  return (
    <dl className="purpose" aria-label="Purpose of this view">
      {row.map(([k, v]) => <div key={k} className={k === "Key result" ? "key" : ""}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}
