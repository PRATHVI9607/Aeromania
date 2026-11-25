import { useEffect, useLayoutEffect, useRef, useState } from "react";

export const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/** Tween a number or a number[] toward `target` (rAF, easeOutCubic). Starts from whatever is currently shown. */
export function useTween<T extends number | number[]>(target: T, ms = 500): T {
  const [v, setV] = useState<T>(target);
  const cur = useRef<T>(target);
  useEffect(() => {
    const from = cur.current;
    if (reduced() || ms <= 0 || (Array.isArray(from) && Array.isArray(target) && from.length !== target.length)) { cur.current = target; setV(target); return; }
    let raf = 0; const t0 = performance.now();
    const step = (now: number) => {
      const k = ease(Math.min(1, (now - t0) / ms));
      const nv = (Array.isArray(target) ? (target as number[]).map((b, i) => (from as number[])[i] + (b - (from as number[])[i]) * k) : (from as number) + ((target as number) - (from as number)) * k) as T;
      cur.current = nv; setV(nv);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]); // eslint-disable-line
  return v;
}

/** FLIP: keyed children of `ref` slide from their old position to the new one whenever `deps` change. */
export function useFlip(ref: React.RefObject<HTMLElement | null>, deps: unknown[]) {
  const prev = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const next = new Map<string, number>();
    const kids = Array.from(el.children) as HTMLElement[];
    for (const k of kids) { const id = k.dataset.key; if (id) next.set(id, k.getBoundingClientRect().top); }
    if (!reduced()) for (const k of kids) {
      const id = k.dataset.key; const was = id ? prev.current.get(id) : undefined;
      if (id && was !== undefined) {
        const d = was - (next.get(id) as number);
        if (Math.abs(d) > 1) { k.animate([{ transform: `translateY(${d}px)` }, { transform: "none" }], { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" }); }
      }
    }
    prev.current = next;
  }, deps); // eslint-disable-line
}
