export interface Tile {
  id: number; aoi: string; date: string; t_cap_min: number;
  lat: number; lon: number; cls: string; conf: number; cloud: number;
  kind: string; sev: number; ha: number; pA: number; pC: number; full_bytes: number;
}
export interface Query {
  id: string; name?: string; pack: "A" | "C"; aois: string[]; min_sev: number; priority: number;
}
export interface Window {
  id: number; station: string; start_min: number; end_min: number; max_el?: number;
}
/** Flat params, same shape as python value.load() (config/value.json "params" -> value). */
export interface Params {
  rupees_per_ha: { A: number; C: number };
  level_fraction: number[]; level_bytes: number[];
  half_life_h: number; pull_threshold: number; cloud_drop: number;
  link_mbps: number; link_efficiency: number; rupees_per_contact_min: number;
}
export interface ParamMeta { assumption: boolean; source: string }
export interface TrackPt { t_min: number; lat: number; lon: number }
export interface Station { id: string; name: string; lat: number; lon: number }
export type PolicyId = "B1" | "B2" | "B3" | "H1" | "H2";
export interface Metrics {
  value: number; ub: number; pct_ub: number | null; minutes_to_90: number | null; ttfi_min: number | null;
  bytes_sent: number; cloud_bytes: number; capacity_bytes: number; total_value: number;
}
export interface RunOut {
  sel: [number, number, number][]; level: number[];
  timeline: { bytes: number[]; value: number[]; cum_value: number[]; cloud_bytes: number[]; cap: number[] };
  metrics: Metrics;
}
export interface SchedOut { results: Record<PolicyId, RunOut>; rho: number; ms: number }
