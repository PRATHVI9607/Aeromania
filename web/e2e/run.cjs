#!/usr/bin/env node
/* HERALD end-to-end QA. See README.md.
 *   node run.cjs <baseUrl> [--label NAME] [--out DIR] [--browsers gpu,cpu,nowebgl] [--max-clicks N] [--routes a,b]
 *   node run.cjs --report DIR            (merge results-*.json in DIR into DIR/REPORT.md)
 * Only reads the app from the outside; never edits web/src. */
const { chromium } = require("playwright-core");
const fs = require("fs"), path = require("path"), os = require("os");
const { execSync } = require("child_process");

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOME = os.homedir();
const BROWSERS = {
  gpu: { exe: `${HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`, args: ["--headless=new", "--use-angle=gl", "--ignore-gpu-blocklist", "--enable-gpu"], globeMs: 20000, actMs: 5000, settle: 300 },
  cpu: { exe: `${HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"], globeMs: 60000, actMs: 12000, settle: 700 },
  chrome: { exe: `${HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`, args: ["--headless=new"], globeMs: 30000, actMs: 6000, settle: 400 },
  nowebgl: { exe: `${HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`, args: ["--headless=new", "--use-angle=gl", "--ignore-gpu-blocklist", "--enable-gpu", "--disable-webgl"], globeMs: 8000, actMs: 5000, settle: 300 },
};

/* ------------------------------------------------------------------ report mode */
if (flag("report")) { report(flag("report")); process.exit(0); }

const base = (argv.find((a) => /^https?:/.test(a)) || "http://127.0.0.1:4194").replace(/\/$/, "");
const label = flag("label", new URL(base).hostname.replace(/\W+/g, "_"));
const out = path.resolve(flag("out", path.join(__dirname, "out")));
const maxClicks = +flag("max-clicks", 120);
const only = (flag("routes", "") || "").split(",").filter(Boolean);

function routeList() {
  let src;
  try { src = execSync("git show HEAD:web/src/App.tsx", { cwd: path.join(__dirname, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { src = fs.readFileSync(path.join(__dirname, "../src/App.tsx"), "utf8"); }
  const rs = [...src.matchAll(/\{\s*id:\s*"([\w-]+)",\s*label:\s*"([^"]+)"/g)].map((m) => ({ id: m[1], label: m[2] }));
  return only.length ? rs.filter((r) => only.includes(r.id)) : rs;
}

/* in-page: find the next not-yet-activated visible interactive element and tag it data-qa-cur */
const PICK = `(args) => {
  const { done, keyCount, maxPer } = args;
  const BASE = 'button,a[href^="#"],[role=tab],[role=option],[role=button],[role=slider],[role=switch],input[type=checkbox],input[type=range],select,summary';
  const root = document.querySelector('#panel') || document.body;
  const cand = new Set([...root.querySelectorAll(BASE), ...document.querySelectorAll('.side .collapse')]);
  for (const el of root.querySelectorAll('tr,li,article,div,span,g,[tabindex="0"]')) {
    if (el.closest(BASE.replace(/,/g, ',') ) && el.closest(BASE) !== el) continue;
    const cs = getComputedStyle(el), p = el.parentElement && getComputedStyle(el.parentElement);
    if (cs.cursor === 'pointer' && p && p.cursor !== 'pointer') cand.add(el);
  }
  const seen = {};
  document.querySelectorAll('[data-qa-cur]').forEach((e) => e.removeAttribute('data-qa-cur'));
  const path = (el) => { const parts = []; let e = el; for (let i = 0; e && e.nodeType === 1 && i < 4; i++, e = e.parentElement) {
    let s = e.tagName.toLowerCase(); if (e.id) { s += '#' + e.id; parts.unshift(s); break; }
    const c = [...e.classList].slice(0, 2).join('.'); if (c) s += '.' + c;
    const a = e.getAttribute('aria-label'); if (a) s += '[aria-label="' + a.slice(0, 30) + '"]';
    if (e.parentElement) { const sib = [...e.parentElement.children].filter((x) => x.tagName === e.tagName); if (sib.length > 1) s += ':nth-of-type(' + (sib.indexOf(e) + 1) + ')'; }
    parts.unshift(s); } return parts.join(' > '); };
  for (const el of cand) {
    const tag = el.tagName.toLowerCase(), type = el.getAttribute('type') || '';
    if (el.disabled || el.getAttribute('aria-disabled') === 'true' || type === 'file') continue;
    if (tag === 'a' && /^https?:/.test(el.getAttribute('href') || '')) continue;
    if (el.classList.contains('skip') || el.classList.contains('sr')) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') continue;
    const lab = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.value || el.id || '').toString().trim().replace(/\\s+/g, ' ').slice(0, 50);
    const role = el.getAttribute('role') || '', key = tag + '|' + role + '|' + type + '|' + lab.replace(/\\d+(\\.\\d+)?/g, '#');
    const n = seen[tag + '|' + role + '|' + type + '|' + lab] = (seen[tag + '|' + role + '|' + type + '|' + lab] || 0) + 1;
    const sig = key + '|' + lab + '|' + n;
    if (done.includes(sig)) continue;
    if ((keyCount[key] || 0) >= maxPer) { done.push(sig); continue; }
    el.setAttribute('data-qa-cur', '1');
    return { sig, key, tag, type, role, lab, sel: path(el), opts: tag === 'select' ? [...el.options].map((o) => o.value) : null, min: el.min, max: el.max, step: el.step, live: /live/i.test(lab) };
  }
  return null;
}`;

const SNAP = `() => { const h = (s) => { let x = 5381; for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0; return x; };
  const m = document.querySelector('#panel') || document.body;
  let ls = ''; try { ls = JSON.stringify(localStorage); } catch {}
  let hd = ''; try { hd = JSON.stringify(window.__herald || {}); } catch {}
  return [location.hash, h(m.innerHTML), h(ls), h(hd), document.title, document.body.className].join('|'); }`;

const STATS = `(b64) => new Promise((res, rej) => { const im = new Image(); im.onload = () => {
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
  const w = im.width, h = im.height, d = x.getImageData(w * .25 | 0, h * .25 | 0, w * .5 | 0, h * .5 | 0).data;
  let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 4) { const l = .2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2]; s += l; s2 += l * l; n++; }
  const m = s / n; const g = x.getImageData(0, 0, w, h); let sig = []; const G = 8;
  for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) { let a = 0, k = 0; for (let yy = (gy * h / G) | 0; yy < ((gy + 1) * h / G | 0); yy += 7) for (let xx = (gx * w / G) | 0; xx < ((gx + 1) * w / G | 0); xx += 7) { a += g.data[(yy * w + xx) * 4 + 1]; k++; } sig.push(Math.round(a / k / 4)); }
  res({ mean: +m.toFixed(1), variance: +(s2 / n - m * m).toFixed(1), sig: sig.join(',') }); };
  im.onerror = () => rej(new Error('decode')); im.src = 'data:image/png;base64,' + b64; })`;

async function main() {
  const routes = routeList();
  fs.mkdirSync(out, { recursive: true });
  const names = (flag("browsers", "gpu,cpu,nowebgl")).split(",");
  for (const bn of names) {
    const t0 = Date.now();
    const res = await runBrowser(bn, BROWSERS[bn], routes);
    res.seconds = Math.round((Date.now() - t0) / 1000);
    fs.writeFileSync(path.join(out, `results-${label}-${bn}.json`), JSON.stringify(res, null, 1));
    console.log(`[${label}/${bn}] done in ${res.seconds}s: ${res.failures.filter((f) => f.sev === "FAIL").length} FAIL, ${res.failures.filter((f) => f.sev === "WARN").length} WARN`);
  }
}

async function runBrowser(bn, cfg, routes) {
  const shotDir = path.join(out, label, bn); fs.mkdirSync(shotDir, { recursive: true });
  const R = { label, browser: bn, base, routes: [], flows: [], failures: [] };
  let nshot = 0;
  const host = new URL(base).host;
  const browser = await chromium.launch({ executablePath: cfg.exe, args: cfg.args, headless: true });
  const helper = await (await browser.newContext()).newPage();
  await helper.setContent("<html></html>");
  const stats = async (buf) => helper.evaluate(eval(STATS), buf.toString("base64"));
  const fail = async (sev, route, where, what, page, tag) => {
    let shot = "";
    if (page && nshot < 60) { shot = path.join(shotDir, `${tag || "fail"}-${++nshot}-${route}.png`); try { await page.screenshot({ path: shot, timeout: 15000 }); } catch { shot = ""; } }
    R.failures.push({ sev, browser: bn, route, where, what: String(what).slice(0, 600), shot });
    console.log(`  ${sev} [${bn}/${route}] ${where}: ${String(what).slice(0, 160)}`);
  };

  /* open a page with a collector */
  async function open(routeId) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await ctx.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; window.open = () => { window.__opened = (window.__opened || 0) + 1; return null; }; });
    const page = await ctx.newPage();
    page.setDefaultTimeout(cfg.actMs);
    const ev = [], dl = [];
    const stripBase = (u) => u.replace(base, "");
    page.on("console", (m) => { if (m.type() === "error") ev.push({ kind: "console", text: m.text().slice(0, 300), url: m.location().url || "" }); });
    page.on("pageerror", (e) => ev.push({ kind: "pageerror", text: String(e.stack || e).slice(0, 400) }));
    page.on("response", (r) => { if (r.status() >= 400) ev.push({ kind: "http", text: `${r.status()} ${stripBase(r.url())}` }); });
    page.on("requestfailed", (r) => { const f = r.failure()?.errorText || ""; if (!/ABORTED/.test(f)) ev.push({ kind: "reqfail", text: `${f} ${stripBase(r.url())}` }); });
    page.on("request", (r) => { try { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol) && u.host !== host) ev.push({ kind: "external", text: r.url().slice(0, 200) }); } catch {} });
    page.on("download", (d) => dl.push(d.suggestedFilename()));
    const t0 = Date.now();
    await page.goto(`${base}/#/${routeId}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => ev.push({ kind: "pageerror", text: "goto: " + e.message }));
    let ttfc = null;
    try { await page.waitForFunction(() => (document.querySelector("#panel")?.innerText || "").trim().length > 60, null, { timeout: 60000, polling: 100 }); ttfc = Date.now() - t0; } catch {}
    return { ctx, page, ev, dl, ttfc };
  }
  const blank = (page) => page.evaluate(() => (document.body.innerText || "").trim().length < 40).catch(() => true);
  const alerts = (page) => page.evaluate(() => [...document.querySelectorAll('[role="alert"]')].map((e) => ({ guard: e.classList.contains("guard"), text: e.innerText.slice(0, 160) }))).catch(() => []);
  const globeStats = async (page) => { const el = page.locator(".gl:visible").first(); const buf = await el.screenshot({ timeout: 20000 }); return { ...(await stats(buf)), buf }; };
  const waitGlobe = async (page) => { try { await page.waitForFunction(() => window.__herald?.globeReady === true, null, { timeout: cfg.globeMs, polling: 250 }); return true; } catch { return false; } };
  const fmtErr = (xs) => xs.map((e) => `${e.kind}: ${e.text}`).join(" || ");

  for (const rt of routes) {
    const id = rt.id, globe = id === "command" || id === "simulation";
    console.log(`[${label}/${bn}] route ${id}`);
    const rr = { id, label: rt.label, ttfcMs: null, loadErrors: [], alerts: [], clicked: 0, noops: [], navs: [], truncated: false, skippedDup: 0, shot: "", failN: 0 };
    R.routes.push(rr);
    let { ctx, page, ev, dl, ttfc } = await open(id);
    try {
      rr.ttfcMs = ttfc;
      if (ttfc == null) await fail("FAIL", id, "route load", "no content (>60 chars in #panel) within 60 s", page);
      if (globe) { const ok = await waitGlobe(page); rr.globeReady = ok; if (!ok && bn !== "nowebgl") await fail("FAIL", id, "window.__herald.globeReady", `not true within ${cfg.globeMs / 1000} s`, page); }
      await sleep(cfg.settle * 2);
      rr.shot = path.join(shotDir, `${id}.png`);
      await page.screenshot({ path: rr.shot, fullPage: true, timeout: 30000 }).catch(() => (rr.shot = ""));
      rr.loadEvents = ev.slice(); rr.loadAlerts = await alerts(page);
      const ownAlerts = rr.loadAlerts;
      for (const a of ownAlerts) {
        if (bn === "nowebgl" && globe && !a.guard) R.failures.push({ sev: "INFO", browser: bn, route: id, where: "[role=alert].gdiag", what: "graceful WebGL fallback shown: " + a.text.replace(/\n/g, " "), shot: rr.shot });
        else await fail("FAIL", id, a.guard ? '[role="alert"].guard' : '[role="alert"]', "alert card on load: " + a.text.replace(/\n/g, " "), page);
      }
      if (await blank(page)) await fail("FAIL", id, "body", "blank page after load", page);
      for (const e of ev.filter((e) => e.kind !== "external")) await fail(bn === "nowebgl" && /webgl|context/i.test(e.text) ? "WARN" : "FAIL", id, "load " + e.kind, e.text, null);
      for (const e of ev.filter((e) => e.kind === "external")) await fail("FAIL", id, "external request", e.text, null);
      if (globe && rr.globeReady) {
        const gs = await globeStats(page).catch(() => null);
        if (gs) { rr.globe = { mean: gs.mean, variance: gs.variance }; const g = path.join(shotDir, `${id}-globe.png`); fs.writeFileSync(g, gs.buf); rr.globeShot = g;
          if (!(gs.mean > 25 && gs.variance > 100)) await fail("FAIL", id, ".gl canvas centre", `Earth not visible: mean ${gs.mean}, variance ${gs.variance} (need mean>25, variance>100)`, null); }
      }

      /* CLICK EVERYTHING */
      if (!(globe && !rr.globeReady && bn !== "nowebgl")) {
        const done = [], keyCount = {};
        const tStart = Date.now(), budget = bn === "cpu" ? 300000 : 150000;
        for (let step = 0; step < maxClicks; step++) {
          if (Date.now() - tStart > budget) { rr.truncated = "time budget"; break; }
          if (page.isClosed()) break;
          const d = await page.evaluate(eval(PICK), { done, keyCount, maxPer: 3 }).catch(() => null);
          if (!d) break;
          done.push(d.sig); keyCount[d.key] = (keyCount[d.key] || 0) + 1;
          const loc = page.locator('[data-qa-cur="1"]').first();
          const mark = ev.length, dlN = dl.length;
          const before = await page.evaluate(eval(SNAP)).catch(() => "");
          let errs = [], how = "click";
          try {
            if (d.tag === "input" && d.type === "range") {
              how = "range min/mid/max";
              const lo = +d.min || 0, hi = d.max === "" ? 100 : +d.max;
              for (const v of [lo, (lo + hi) / 2, hi, lo]) { await loc.evaluate((el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, v); await sleep(cfg.settle / 2); }
            } else if (d.tag === "select") {
              how = "select each option"; const orig = await loc.inputValue();
              for (const o of d.opts) { await loc.selectOption(o); await sleep(cfg.settle / 2); }
              await loc.selectOption(orig).catch(() => {});
            } else if (d.tag === "input" && d.type === "checkbox") { how = "toggle x2"; await loc.click(); await sleep(cfg.settle / 2); await loc.click(); }
            else if (d.role === "slider") { how = "keys Home/Right/End"; await loc.focus(); for (const k of ["Home", "ArrowRight", "End"]) { await page.keyboard.press(k); await sleep(100); } }
            else await loc.click();
          } catch (e) { errs.push({ kind: "unclickable", text: String(e.message).split("\n")[0].slice(0, 200) }); }
          await sleep(cfg.settle);
          if (d.tag !== "select" && d.tag !== "input") await page.keyboard.press("Escape").catch(() => {});
          await sleep(100);
          rr.clicked++;
          const after = await page.evaluate(eval(SNAP)).catch(() => "");
          const nw = ev.slice(mark).filter((e) => !(d.live && e.kind === "external"));
          errs = errs.concat(nw);
          const al = (await alerts(page)).filter((a) => a.guard || bn !== "nowebgl");
          const wasAlert = ownAlerts.length;
          const isBlank = await blank(page);
          const where = `${d.sel} [${d.lab}]`;
          if (errs.length) { rr.failN++; await fail(errs.every((e) => e.kind === "unclickable") ? "WARN" : "FAIL", id, where, `${how}: ${fmtErr(errs)}`, page); }
          if (al.length > wasAlert) { rr.failN++; await fail("FAIL", id, where, `${how}: Guard/alert appeared: ${al.map((a) => a.text).join(" | ").replace(/\n/g, " ")}`, page); await ctx.close(); ({ ctx, page, ev, dl } = await open(id)); if (globe) await waitGlobe(page); ownAlerts.length = 0; continue; }
          if (isBlank) { rr.failN++; await fail("FAIL", id, where, `${how}: page went blank`, page); }
          if (before === after && dl.length === dlN && !errs.length) rr.noops.push({ label: d.lab, selector: d.sel, how });
          const hnow = await page.evaluate(() => location.hash).catch(() => "");
          if (hnow !== `#/${id}`) { rr.navs.push({ label: d.lab, to: hnow }); await page.evaluate((h) => { location.hash = h; }, `/${id}`).catch(() => {}); await sleep(cfg.settle * 2); if (globe) await sleep(500); }
        }
        if (rr.clicked >= maxClicks) rr.truncated = rr.truncated || `max-clicks ${maxClicks}`;
        rr.downloads = dl.slice();
      }
    } catch (e) { await fail("FAIL", id, "harness", e.stack || e.message, page); }
    await ctx.close().catch(() => {});
  }

  /* ----------------------------------------------------------- specific flows */
  const flow = async (name, fn, routeId, needGlobe) => {
    const f = { name, status: "pass", notes: [] }; R.flows.push(f);
    console.log(`[${label}/${bn}] flow ${name}`);
    let o;
    try {
      o = await open(routeId); const { page } = o;
      if (needGlobe) { const ok = await waitGlobe(page); if (!ok) { if (bn === "nowebgl") { f.status = "skip"; f.notes.push("no WebGL: globe checks not applicable"); await o.ctx.close(); return; } throw new Error(`globeReady not true in ${cfg.globeMs / 1000} s`); } }
      await fn(page, f, o);
      const bad = o.ev.filter((e) => ["pageerror", "console"].includes(e.kind));
      if (bad.length) f.notes.push("console/page errors during flow: " + fmtErr(bad.slice(0, 3)));
      if (bad.length) { f.status = "fail"; await fail("FAIL", routeId, `flow:${name}`, "errors during flow: " + fmtErr(bad.slice(0, 3)), page); }
    } catch (e) { f.status = "fail"; f.notes.push(String(e.message).split("\n")[0]); await fail("FAIL", routeId, `flow:${name}`, e.message.split("\n")[0], o?.page); }
    await o?.ctx.close().catch(() => {});
  };
  const must = (c, msg) => { if (!c) throw new Error(msg); };
  const setRange = (loc, v) => loc.evaluate((el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, v);

  await flow("ledger: status persists + CSV export", async (page, f) => {
    const first = page.locator('input[aria-label^="Select "]').first(); await first.waitFor({ timeout: 30000 });
    const aria = await first.getAttribute("aria-label"); const rowId = aria.replace("Select ", "");
    await first.check();
    await page.locator(".bulk button", { hasText: /^Escalated$/ }).click();
    const rowTxt = async () => (await page.locator("tbody tr", { has: page.locator(`input[aria-label="${aria}"]`) }).first().innerText());
    must(/escalated/i.test(await rowTxt()), `row ${rowId} does not show Escalated after setting it`);
    await page.reload(); await page.locator(`input[aria-label="${aria}"]`).waitFor({ timeout: 30000 });
    must(/escalated/i.test(await rowTxt()), `row ${rowId}: status Escalated lost after reload`);
    const ls = await page.evaluate(() => JSON.stringify(localStorage));
    f.notes.push(`persisted ${rowId} in localStorage (${ls.length} chars)`);
    const [d] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.locator(".btns button", { hasText: /^CSV$/ }).first().click()]);
    const p = await d.path(); const sz = fs.statSync(p).size; must(sz > 100, `CSV tiny (${sz} B)`);
    const head = fs.readFileSync(p, "utf8").split("\n")[0]; must(/status/.test(head), "CSV header lacks status: " + head);
    f.notes.push(`CSV ${d.suggestedFilename()} ${sz} B`);
  }, "ledger");

  await flow("siting: pin + compare + shortlist CSV", async (page, f) => {
    await page.getByRole("button", { name: "Show table" }).click();
    const pins = page.locator('input[aria-label^="Pin "]'); await pins.first().waitFor({ timeout: 20000 });
    await pins.nth(0).check(); await pins.nth(1).check();
    await page.waitForFunction(() => /2 pinned/.test(document.body.innerText), null, { timeout: 5000 });
    must(!(await page.getByText("Pin up to three cells to compare").count()), "compare area still shows the empty hint");
    const cmpTxt = await page.locator("h3", { hasText: "Compare pinned" }).locator("xpath=following-sibling::*[1]").innerText().catch(() => "");
    f.notes.push("compare block text: " + cmpTxt.replace(/\s+/g, " ").slice(0, 120)); must(cmpTxt.length > 20, "compare block empty");
    await page.reload(); await page.getByRole("button", { name: "Show table" }).click();
    await page.waitForFunction(() => /2 pinned/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => { throw new Error("pins not persisted after reload"); });
    const [d] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.getByRole("button", { name: "Shortlist CSV" }).click()]);
    must(fs.statSync(await d.path()).size > 50, "shortlist CSV empty");
  }, "siting");

  await flow("planner: priority slider recomputes", async (page, f) => {
    const chip = page.locator(".chip", { hasText: /ms last run/ }); await chip.first().waitFor({ timeout: 30000 });
    const t0 = await chip.first().innerText(); const list0 = await page.locator(".passes").innerText(); const kpi0 = await page.locator(".kgrid").first().innerText();
    const sl = page.locator('input[type=range][aria-label^="priority of"]').first(); await sl.waitFor();
    const orig = await sl.inputValue();
    await setRange(sl, orig === "5" ? 0 : 5);
    await page.waitForFunction((t) => { const c = [...document.querySelectorAll(".chip")].find((x) => /ms last run|computing/.test(x.innerText)); return c && c.innerText !== t; }, t0, { timeout: 20000 }).catch(() => { throw new Error(`recompute chip never changed from "${t0}"`); });
    await page.waitForFunction(() => /ms last run/.test(document.body.innerText), null, { timeout: 20000 }).catch(() => { throw new Error('"ms last run" did not reappear after the slider change'); });
    await sleep(800);
    const list1 = await page.locator(".passes").innerText(); const kpi1 = await page.locator(".kgrid").first().innerText();
    f.notes.push(`chip ${t0} -> ${await chip.first().innerText()}`);
    must(list1 !== list0 || kpi1 !== kpi0, "pass list and KPI strip identical after changing the priority slider 1->extreme");
    if (list1 === list0) f.notes.push("pass list unchanged (KPIs changed)");
  }, "queries");

  await flow("evidence: verify chain, deep dive, tamper + reset", async (page, f) => {
    await page.getByRole("button", { name: "Verify chain" }).click();
    await page.waitForFunction(() => { const m = document.body.innerText.match(/(\d+)\/(\d+) cards pass(, running)?/); return m && !m[3] && +m[2] > 0; }, null, { timeout: 90000 }).catch(() => { throw new Error("verify never finished"); });
    const m = (await page.locator("p.mono").filter({ hasText: "cards pass" }).first().innerText()).match(/(\d+)\/(\d+)/);
    f.notes.push(`verify ${m[1]}/${m[2]}`); must(m[1] === m[2], `verify chain: only ${m[1]}/${m[2]} cards pass`);
    await page.getByRole("tab", { name: "Deep dive" }).click();
    await page.waitForFunction(() => document.querySelector(".deep-chain") || document.querySelector('[role="alert"]'), null, { timeout: 40000 }).catch(() => { throw new Error("Deep dive never rendered .deep-chain"); });
    must(!(await alerts(page)).length, "Deep dive shows an alert card");
    const tb = page.getByRole("button", { name: /Try to tamper/ }); await tb.scrollIntoViewIfNeeded(); await tb.click();
    await page.waitForFunction(() => document.querySelectorAll(".deep-link.bad").length > 0, null, { timeout: 20000 }).catch(() => { throw new Error("tamper: no .deep-link.bad (chain never turned red)"); });
    const nbad = await page.locator(".deep-link.bad").count(); f.notes.push(`tamper turned ${nbad} links red`);
    await page.getByRole("button", { name: "Reset", exact: true }).click({ timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll(".deep-link.bad").length === 0, null, { timeout: 5000 }).catch(() => { throw new Error("Reset did not clear red links"); });
  }, "evidence");

  R.flows.push({ name: "AI Lab", status: "skip", notes: ["not mounted: no 'lab' id in VIEWS at HEAD (web/src/lab/dev.html is a separate dev page); not tested"] });

  await flow("simulation: date slider, imagery URL, play", async (page, f) => {
    const gs = await globeStats(page); f.notes.push(`globe mean ${gs.mean} var ${gs.variance}`);
    for (const tab of ["Bengaluru A", "Hasdeo C", "Sone C"]) {
      await page.getByRole("tab", { name: tab }).click(); await sleep(1500);
      const sl = page.locator('input[data-sim="date"]'); const max = +(await sl.getAttribute("max")); const seen = [];
      for (let v = 0; v <= max; v++) {
        await setRange(sl, v); await sleep(bn === "cpu" ? 1800 : 1300);
        const s = await page.evaluate(() => window.__herald?.sim); const hud = await page.locator("[data-sim-date]").innerText().catch(() => "");
        seen.push(`${s?.date}|${s?.imagery}`);
        must(s?.date === hud, `${tab} v=${v}: __herald.sim.date ${s?.date} != HUD ${hud}`);
      }
      must(new Set(seen.map((x) => x.split("|")[0])).size === max + 1, `${tab}: dates not all distinct: ${seen.join(" ; ")}`);
      must(new Set(seen.map((x) => x.split("|")[1])).size === max + 1, `${tab}: imagery URLs not all distinct: ${seen.join(" ; ")}`);
      f.notes.push(`${tab}: ${max + 1} dates ok`);
      await setRange(sl, 0); await sleep(1200);
      const d0 = (await page.evaluate(() => window.__herald?.sim))?.date;
      await page.getByRole("button", { name: "Play", exact: true }).click(); await sleep(bn === "cpu" ? 6500 : 4500);
      const d1 = (await page.evaluate(() => window.__herald?.sim))?.date;
      must(d1 !== d0, `${tab}: Play did not advance (still ${d0})`);
      await page.getByRole("button", { name: "Pause", exact: true }).click();
    }
  }, "simulation", true);

  await flow("command: layers, clock, speed, fly-to, tour", async (page, f) => {
    const gs = await globeStats(page); f.notes.push(`globe mean ${gs.mean} var ${gs.variance}`);
    await sleep(1500);
    const L = () => page.evaluate(() => JSON.stringify(window.__herald?.layers || {}));
    for (const cb of await page.locator("input[data-layer]").all()) {
      const k = await cb.getAttribute("data-layer"); const b = JSON.parse(await L());
      await cb.click(); await sleep(500); const a = JSON.parse(await L());
      if (a[k] === b[k]) { await fail("FAIL", "command", `input[data-layer="${k}"]`, `__herald.layers.${k} did not change on toggle (${b[k]} -> ${a[k]})`, page); f.status = "fail"; }
      f.notes.push(`layer ${k}: ${b[k]} -> ${a[k]}`);
      await cb.click(); await sleep(300);
    }
    const ck = () => page.locator(".ck").first().innerText();
    const play = page.locator(".cbar button.primary").first();
    const lab0 = (await play.innerText()).trim(); f.notes.push(`play button initially reads "${lab0}"`);
    if (/Play/.test(lab0)) await play.click(); // Mission autoplays; make sure it is playing for the speed checks
    for (const sp of ["1x", "10x", "60x", "300x", "1200x"]) {
      await page.locator('[aria-label="speed"] button', { hasText: new RegExp(`^${sp}$`) }).click();
      const c0 = await ck(); await sleep(2600); const c1 = await ck();
      f.notes.push(`speed ${sp}: ${c0} -> ${c1}`);
      if (c0 === c1 && !/^(1x|10x)$/.test(sp)) { await fail("FAIL", "command", `[aria-label=speed] button ${sp}`, `clock text did not change in 2.6 s while playing (${c0})`, page); f.status = "fail"; }
    }
    await play.click(); await sleep(400); const p0 = await ck(); await sleep(1500); must(p0 === (await ck()), "clock still advancing after Pause");
    must(/Play/.test(await play.innerText()), "button does not read Play after pause");
    await play.click(); const q0 = await ck(); await sleep(2500); must(q0 !== (await ck()), "clock did not advance after pressing Play again"); await play.click();
    const sel = page.locator('select[aria-label="Fly to"]'); const opts = (await sel.locator("option").evaluateAll((o) => o.map((x) => x.value))).filter(Boolean);
    let prev = (await globeStats(page)).sig;
    for (const o of opts) {
      await sel.selectOption(o); await sleep(bn === "cpu" ? 6000 : 3500);
      const g = await globeStats(page); f.notes.push(`fly ${o}: view ${g.sig === prev ? "UNCHANGED" : "changed"}, mean ${g.mean}`);
      if (g.sig === prev) { await fail("WARN", "command", `select[aria-label="Fly to"] = ${o}`, "canvas identical to previous view after selecting (camera did not visibly move)", page); }
      prev = g.sig;
    }
    await page.getByRole("button", { name: "Story tour" }).click();
    let steps = 0, lastTxt = "";
    for (; steps < 20; steps++) {
      const tx = await page.locator(".tour p").first().innerText().catch(() => ""); if (!tx) break;
      must(tx !== lastTxt, `tour step ${steps + 1} text identical to previous`); lastTxt = tx;
      await page.locator(".tour button.primary").click(); await sleep(bn === "cpu" ? 2500 : 1500);
    }
    f.notes.push(`tour ${steps} steps`); must(steps >= 3 && steps < 20, `tour stepped ${steps} times`);
    must(!(await page.locator(".tour").count()), "tour card still open after Done");
  }, "command", true);

  await browser.close();
  return R;
}

/* ------------------------------------------------------------------ report */
function report(dir) {
  const files = fs.readdirSync(dir).filter((f) => /^results-.*\.json$/.test(f)).sort();
  const all = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
  const L = [`# HERALD e2e report`, ``, `Generated ${new Date().toISOString()}. Targets: ${[...new Set(all.map((r) => `${r.label} (${r.base})`))].join(", ")}.`, ``];
  L.push(`## Failures`, ``);
  for (const sev of ["FAIL", "WARN", "INFO"]) {
    const rows = all.flatMap((r) => r.failures.filter((f) => f.sev === sev).map((f) => ({ ...f, target: r.label })));
    L.push(`### ${sev} (${rows.length})`, ``);
    if (!rows.length) { L.push("none", ""); continue; }
    L.push(`| target | browser | route | element / check | what happened | screenshot |`, `|---|---|---|---|---|---|`);
    for (const f of rows) L.push(`| ${f.target} | ${f.browser} | ${f.route} | \`${(f.where || "").replace(/\|/g, "\\|")}\` | ${String(f.what).replace(/\|/g, "\\|").replace(/\n/g, " ")} | ${f.shot || ""} |`);
    L.push("");
  }
  for (const r of all) {
    L.push(`## Summary: ${r.label} / ${r.browser} (${r.seconds}s)`, ``, `| route | ttfc ms | load errs | alerts | globe mean/var | clicked | action fails | no-ops | navs | truncated |`, `|---|---|---|---|---|---|---|---|---|---|`);
    for (const x of r.routes) L.push(`| ${x.id} | ${x.ttfcMs ?? "none"} | ${(x.loadEvents || []).length} | ${(x.loadAlerts || []).length} | ${x.globe ? `${x.globe.mean}/${x.globe.variance}` : x.globeReady === false ? "not ready" : "-"} | ${x.clicked} | ${x.failN} | ${x.noops.length} | ${x.navs.length} | ${x.truncated || ""} |`);
    L.push(``, `Flows:`, ``, `| flow | status | notes |`, `|---|---|---|`);
    for (const f of r.flows) L.push(`| ${f.name} | ${f.status} | ${f.notes.join("; ").replace(/\|/g, "/").slice(0, 400)} |`);
    L.push(``, `<details><summary>No-op elements (no DOM/state change observed)</summary>`, ``);
    for (const x of r.routes) for (const n of x.noops) L.push(`- ${x.id}: \`${n.selector}\` [${n.label}] (${n.how})`);
    L.push(``, `</details>`, ``);
  }
  fs.writeFileSync(path.join(dir, "REPORT.md"), L.join("\n"));
  console.log("wrote", path.join(dir, "REPORT.md"));
}

main().catch((e) => { console.error(e); process.exit(1); });
