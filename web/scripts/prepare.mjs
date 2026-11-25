// Copies generated reports into web/public/data/reports so the UI never hard-codes numbers.
import { cpSync, mkdirSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = join(root, "reports");
const dst = join(root, "web", "public", "data", "reports");
const want = /^(model|sim|vault|economics|evidence|change_.+)\.json$/;
mkdirSync(dst, { recursive: true });
const copied = existsSync(src) ? readdirSync(src).filter((f) => want.test(f)) : [];
for (const f of copied) cpSync(join(src, f), join(dst, f));
// config files the UI needs (station list)
const cfg = join(root, "config", "stations.json");
if (existsSync(cfg)) cpSync(cfg, join(dst, "stations.json"));
writeFileSync(join(dst, "index.json"), JSON.stringify(copied));
console.log(`prepare: ${copied.length} report(s) -> web/public/data/reports`);
