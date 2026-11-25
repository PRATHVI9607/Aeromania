// Copies generated reports into web/public/data/reports so the UI never hard-codes numbers.
import { cpSync, mkdirSync, readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = join(root, "reports");
const dst = join(root, "web", "public", "data", "reports");
const want = /^(model|sim|vault|economics|evidence|siting|sites_blr|survey_blr|audit_blr|audit_blr_lead|audit_trackc)\.json$/;
mkdirSync(dst, { recursive: true });
const files = existsSync(src) ? readdirSync(src) : [];
const copied = [];
for (const f of files.filter((f) => want.test(f))) { cpSync(join(src, f), join(dst, f)); copied.push(f); }
// change_{aoi}.json is ~1 MB with per-capture tiles: ship only summary + validation + pair.
for (const f of files) {
  const m = /^change_([a-z0-9]+)\.json$/.exec(f);
  if (!m) continue;
  const j = JSON.parse(readFileSync(join(src, f), "utf-8"));
  const out = `change_${m[1]}_summary.json`;
  writeFileSync(join(dst, out), JSON.stringify({ aoi: j.aoi, pair: j.pair, summary: j.summary, validation: j.validation }));
  copied.push(out);
}
const cfg = join(root, "config", "stations.json");
if (existsSync(cfg)) cpSync(cfg, join(dst, "stations.json"));
writeFileSync(join(dst, "index.json"), JSON.stringify(copied));
console.log(`prepare: ${copied.length} report(s) -> web/public/data/reports`);
