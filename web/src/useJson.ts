import { useEffect, useState } from "react";
import { fetchJson } from "./data";

/** undefined = loading, null = file absent. */
export function useJson<T = any>(...paths: string[]): T | null | undefined {
  const [v, setV] = useState<T | null | undefined>(undefined);
  useEffect(() => {
    (async () => { for (const p of paths) { const j = await fetchJson(p); if (j) return setV(j); } setV(null); })();
  }, [paths.join("|")]); // eslint-disable-line
  return v;
}
