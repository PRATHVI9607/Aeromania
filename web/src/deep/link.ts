// Link budget for a circular orbit. Earth radius 6371 km, mu 398600.4418 km^3/s^2.
export const RE = 6371, MU = 398600.4418;
const rad = Math.PI / 180;

export interface LinkIn { altKm: number; minElDeg: number; mbps: number; eff: number; rho: number }
export interface LinkOut {
  periodMin: number; earthAngleDeg: number; slantKm: number; maxPassMin: number; bytesPerPass: number; bytesEffective: number;
}

export function linkBudget(i: LinkIn): LinkOut {
  const a = RE + i.altKm, el = i.minElDeg * rad;
  const lam = Math.acos((RE / a) * Math.cos(el)) - el; // earth-central half-angle of the visibility cone
  const T = 2 * Math.PI * Math.sqrt((a * a * a) / MU); // s
  const dur = (T * lam) / Math.PI; // s, overhead pass (max)
  const slant = Math.sqrt(RE * RE + a * a - 2 * RE * a * Math.cos(lam));
  const bytes = (i.mbps * 1e6 * i.eff * dur) / 8;
  return { periodMin: T / 60, earthAngleDeg: lam / rad, slantKm: slant, maxPassMin: dur / 60, bytesPerPass: bytes, bytesEffective: bytes / i.rho };
}

/** Whole items that fit in `bytes`. */
export const fits = (bytes: number, itemBytes: number) => (itemBytes > 0 ? Math.floor(bytes / itemBytes) : 0);

/** Relative agreement with a simulator value. */
export const within = (v: number, ref: number, tol: number) => Math.abs(v - ref) <= tol * Math.abs(ref);
