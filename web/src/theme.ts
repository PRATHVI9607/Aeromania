import { useSyncExternalStore } from "react";
export type Theme = "light" | "dark";
const KEY = "herald.theme", subs = new Set<() => void>();
export const getTheme = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
export function setTheme(t: Theme) { document.documentElement.dataset.theme = t; try { localStorage.setItem(KEY, t); } catch { /* private mode */ } subs.forEach((f) => f()); }
export function initTheme() { let t: string | null = null; try { t = localStorage.getItem(KEY); } catch { /* ignore */ } document.documentElement.dataset.theme = t === "dark" ? "dark" : "light"; }
export const useTheme = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, getTheme);
/** Read a CSS custom property (for canvas / Cesium colours). */
export const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
