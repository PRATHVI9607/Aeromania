export function inr(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
}
export const bytes = (b: number) => b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b >= 1e3 ? `${(b / 1e3).toFixed(1)} kB` : `${Math.round(b)} B`;
export const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.floor(min % 60)).padStart(2, "0")}`;
export const ha = (v: number, d = 1) => `${v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d })} ha`;
export const msf = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)} ms`;
export const pctf = (x: number | null | undefined, d = 0) => (x == null ? "n/a" : `${(x * 100).toFixed(d)}%`);
