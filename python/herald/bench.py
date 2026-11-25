"""Latency bench: ONNX int8/fp32 on CPU (batch 1, 64) + torch GPU. Merges into reports/model.json."""
import os
import platform
import statistics
import sys
import time

import numpy as np

from herald import model as M


def cpu_name():
    try:
        for line in open("/proc/cpuinfo", encoding="utf-8"):
            if line.startswith("model name"):
                return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return platform.processor() or platform.machine()


def ms_per_chip(fn, b, n=30, warm=5):
    for _ in range(warm):
        fn()
    t = []
    for _ in range(n):
        s = time.perf_counter()
        fn()
        t.append(time.perf_counter() - s)
    return 1000 * statistics.median(t) / b


def wait_idle(limit=1.5, secs=180):
    """Poll the 1-min load average until < limit (max secs); other agents share this box."""
    t = time.time()
    while hasattr(os, "getloadavg") and os.getloadavg()[0] >= limit and time.time() - t < secs:
        time.sleep(5)
    return os.getloadavg()[0] if hasattr(os, "getloadavg") else None


def main(argv):
    global START_LOAD
    START_LOAD = wait_idle()
    rng = np.random.default_rng(0)
    lat = {"cpu": cpu_name(), "method": "median of 30 runs after 5 warmup, ms/chip amortized"}
    for name, p in (("int8", M.INT8), ("fp32", M.FP32)):
        s = M.ort_session(p)
        for b in (1, 64):
            x = rng.standard_normal((b, 5, 64, 64), dtype=np.float32)
            lat[f"ms_per_chip_{name}_cpu_b{b}"] = ms_per_chip(lambda s=s, x=x: s.run(None, {"x": x}), b)
    sweep = {}  # int8, ORT_ENABLE_ALL; settings = affinity set, intra_op threads, spinning, batch
    cpus = sorted(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else None
    pcores = [c for c in (0, 2, 4, 6) if cpus and c in cpus]   # i5-13420H: logical 0-7 = 4 P-cores x 2 HT
    plog = [c for c in range(8) if cpus and c in cpus]
    aff = [("all", cpus)] + ([("P-logical0-7", plog), ("P-physical0,2,4,6", pcores)] if len(plog) == 8 else [])
    for an, cs in aff:
        if cs:
            os.sched_setaffinity(0, cs)
        for th, spin in ((2, False), (4, False), (4, True), (8, True)):
            if cs and th > len(cs):
                continue
            s_ = M.ort_session(M.INT8, th, spin)
            for b in (64, 128):
                x = rng.standard_normal((b, 5, 64, 64), dtype=np.float32)
                sweep[f"aff={an},threads={th},spin={int(spin)},batch={b}"] = ms_per_chip(lambda s_=s_, x=x: s_.run(None, {"x": x}), b, n=15)
    if cpus:
        os.sched_setaffinity(0, cpus)
    lat["int8_sweep_ms_per_chip"] = sweep
    lat["best_int8_setting"] = min(sweep, key=sweep.get)
    lat["ms_per_chip_int8_cpu_best"] = sweep[lat["best_int8_setting"]]
    try:
        import torch
        if torch.cuda.is_available():
            m = M.load_model("cuda")
            x = torch.randn(64, 5, 64, 64, device="cuda")

            def f():
                with torch.no_grad():
                    m(x)
                torch.cuda.synchronize()
            lat["ms_per_chip_torch_gpu_b64"] = ms_per_chip(f, 64)
            lat["gpu"] = torch.cuda.get_device_name(0)
    except Exception as e:  # noqa: BLE001
        print("gpu bench skipped:", e, file=sys.stderr)
    lat["device"] = lat["cpu"]
    lat["ms_per_chip_int8_cpu_b64_best"] = min(v for k, v in sweep.items() if k.endswith("batch=64"))
    lat["load_avg_start"] = START_LOAD
    lat["load_avg_1m"] = os.getloadavg()[0] if hasattr(os, "getloadavg") else None
    M.update_report({"latency": lat})
    print(lat)
    print("best overall:", lat["best_int8_setting"], round(lat["ms_per_chip_int8_cpu_best"], 3), "load", lat["load_avg_1m"])
    print("G4 (<1 ms/chip int8 b64):", "PASS" if lat["ms_per_chip_int8_cpu_b64_best"] < 1 else "FAIL")
    return 0
