# HERALD
One project, three tracks: A real-data change insights, B onboard AI + orbit + value scheduler + economics, C protective evidence pack (land-cover only, never people).
Spec: PRD.md. Live state, contracts, and who-owns-what: HANDOFF.md (read it first, update your section when done).

## Rules
- Python 3.11 via uv (`uv run python -m herald <cmd>`), pathlib only, `encoding="utf-8"`, no `shell=True`, lowercase filenames, LF endings. Windows + Linux must both work (`num_workers=0` on win32, `if __name__ == "__main__":` guards).
- All shared paths come from `python/herald/paths.py`. Never hard-code absolute paths.
- Demo path is offline (vault). Network only inside `vault`/`labels` build steps.
- Every number shown in the UI is read from a generated JSON in `web/public/data/` or `reports/`. Label every economic number as an assumption.
- No Cesium ion, no API keys, no paid services.
- Never write fake/measured-looking numbers. If a gate fails, report the real number and the gap.
- Commits: conventional messages, NO "Co-Authored-By" or any AI attribution trailer. Local repo only, never push.

## Order
M0 skeleton → M1 vault → M2 labels → M3 model → M4 change → M5 sched → M6 sim → M7 web → M8 packs → M9 deploy → M10 hw (sim only) → M11 pitch script.

## Tests
pytest (`uv run pytest -q`), vitest (`cd web && npx vitest run`). Py↔TS scheduler parity test must pass.

## Coding behavior (Karpathy guidelines)
1. Think before coding: state assumptions, surface tradeoffs, name confusion instead of guessing.
2. Simplicity first: minimum code that solves the problem, no speculative abstractions or config.
3. Surgical changes: touch only what the task needs; match existing style; remove only orphans you created.
4. Goal-driven: turn each task into a verifiable check (test, metric, file exists) and loop until it passes.
5. Shortcuts with known limits get a comment: `# shortcut: <limit>, <when to upgrade>`.
