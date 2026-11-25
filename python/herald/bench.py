"""Latency bench: ONNX int8/fp32 on CPU (batch 1, 64) + torch GPU. Merges into reports/model.json."""
import platform
import statistics
import sys
import time

import numpy as np

from herald import model as M


def cpu_name():
    try:
        for l in open("/proc/cpuinfo", encoding="utf-8"):
            if l.startswith("model name"):
                return l.split(":", 1)[1].strip()
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


def main(argv):
    rng = np.random.default_rng(0)
    lat = {"cpu": cpu_name(), "method": "median of 30 runs after 5 warmup, ms/chip amortized"}
    for name, p in (("int8", M.INT8), ("fp32", M.FP32)):
        s = M.ort_session(p)
        for b in (1, 64):
            x = rng.standard_normal((b, 5, 64, 64), dtype=np.float32)
            lat[f"ms_per_chip_{name}_cpu_b{b}"] = ms_per_chip(lambda: s.run(None, {"x": x}), b)
    sweep = {}  # int8, graph_optimization_level=ORT_ENABLE_ALL, intra_op threads x batch
    for th in (None, 2, 4, 6):
        s_ = M.ort_session(M.INT8, th)
        for b in (64, 128, 256):
            x = rng.standard_normal((b, 5, 64, 64), dtype=np.float32)
            sweep[f"threads={th or 'default'},batch={b}"] = ms_per_chip(lambda: s_.run(None, {"x": x}), b, n=15)
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
    lat["load_avg_1m"] = __import__("os").getloadavg()[0] if hasattr(__import__("os"), "getloadavg") else None
    r = M.update_report({"latency": lat})
    print(lat)
    print("best overall:", lat["best_int8_setting"], round(lat["ms_per_chip_int8_cpu_best"], 3), "load", lat["load_avg_1m"])
    print("G4 (<1 ms/chip int8 b64):", "PASS" if lat["ms_per_chip_int8_cpu_b64_best"] < 1 else "FAIL")
    return 0
