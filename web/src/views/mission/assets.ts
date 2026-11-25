/** Mission-view assets: inline SVG icons (as data URLs for Cesium billboards) and orbit geometry. Nothing is fetched. */
const svg = (s: string) => `data:image/svg+xml;utf8,${encodeURIComponent(s)}`;

/** Satellite seen from above, bus pointing up (direction of travel), panels across track. */
export const SAT_ICON = svg(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
<g stroke="#0b1020" stroke-width="1.5" stroke-linejoin="round">
<rect x="3" y="36" width="34" height="24" rx="1.5" fill="#2f5fd0"/><rect x="59" y="36" width="34" height="24" rx="1.5" fill="#2f5fd0"/>
<rect x="37" y="46" width="4" height="4" fill="#9aa4b2"/><rect x="55" y="46" width="4" height="4" fill="#9aa4b2"/>
<rect x="38" y="26" width="20" height="46" rx="3" fill="#e6c25a"/><rect x="41" y="29" width="14" height="40" rx="2" fill="#f5e3a1" stroke="none"/>
<circle cx="48" cy="19" r="8" fill="#f4f4f5"/><circle cx="48" cy="19" r="3" fill="#475569" stroke="none"/><rect x="47" y="25" width="2" height="5" fill="#475569" stroke="none"/>
</g><g stroke="#9db8ff" stroke-width="1" opacity=".85"><path d="M14 36v24M25 36v24M70 36v24M81 36v24M3 48h34M59 48h34"/></g></svg>`);

/** Ground-station dish. */
export const DISH_ICON = svg(`<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">
<g stroke="#042f2e" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">
<path d="M18 50h20l-6-14h-8z" fill="#cbd5e1"/><path d="M12 22c0 10 8 16 18 14L14 14c-1 2-2 5-2 8z" fill="#f1f5f9"/>
<path d="M14 14l16 22" fill="none"/><path d="M33 10l12-6M40 19l8-4" stroke="#2dd4bf"/><circle cx="31" cy="26" r="2" fill="#2dd4bf" stroke="none"/></g></svg>`);
export const DISH_ICON_LIVE = DISH_ICON.replace(/%232dd4bf/g, "%23ffffff");

/** Surface radius (km) within which a satellite at altitude `h` is above `el` degrees elevation. */
export function groundRangeKm(h: number, el: number, Re = 6371): number {
  const e = (el * Math.PI) / 180, lam = Math.acos((Re * Math.cos(e)) / (Re + h)) - e;
  return Re * lam;
}

export const TRK = { A: "#FF8A3D", C: "#C084FC", other: "#2DD4BF" } as const;
export const CAT_COLOR: Record<string, string> = { new_layout: "#FF8A3D", building_construction: "#FF8A3D", agri_ambiguous: "#FACC15", lake_filling_lead: "#38BDF8" };
