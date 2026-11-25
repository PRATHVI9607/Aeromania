"""`python -m herald all [--train] [--web] [--quick]`: regenerate every report from the local vault, offline.

Order: (train/calibrate/export) -> score -> change -> evidence -> siting -> sim -> bench -> web data.
Network steps (vault build, labels, first siting fetch) are NOT run here; run them once before.
--quick skips bench and the per-capture embedding score (fast smoke run).
"""
import shutil
import subprocess
import sys
import time

from herald import cli, paths


def _run(cmd: list[str]) -> None:
    t = time.perf_counter()
    print(f"\n== herald {' '.join(cmd)}", flush=True)
    rc = cli.main(cmd)
    if rc:
        raise SystemExit(f"step failed ({rc}): herald {' '.join(cmd)}")
    print(f"   done in {time.perf_counter() - t:.1f} s", flush=True)


def main(argv: list[str]) -> int:
    flags = set(argv[1:])
    steps = []
    if "--train" in flags:
        steps += [["train"], ["calibrate"], ["calibrate", "--cloud"], ["calibrate", "--wc"], ["export"]]
    steps += [["score"]]
    if "--quick" not in flags:
        steps += [["score", "--change"]]
    steps += [["change"], ["evidence"], ["evidence", "verify"], ["crops"], ["siting"], ["sim"]]
    if "--quick" not in flags:
        steps += [["bench"]]
    for s in steps:
        _run(s)
    if "--web" in flags:
        npm = shutil.which("npm")
        if not npm:
            raise SystemExit("npm not found; install Node 20+ or drop --web")
        subprocess.run([npm, "run", "build"], cwd=paths.WEB, check=True)
    print("\nall steps OK")
    return 0


if __name__ == "__main__":
    sys.exit(main(["all"] + sys.argv[1:]))
