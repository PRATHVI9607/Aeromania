import type { Data } from "../data";
import type { Query, SchedOut } from "../types";
export interface ViewProps { data: Data; out: SchedOut | null; queries: Query[]; rho: number }
