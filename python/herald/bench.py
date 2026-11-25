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
    x = rng.standard_normal((64, 5, 64, 64), dtype=np.float32)
    for th in (2, 4):  # fewer threads often wins when the box is shared
        s = M.ort_session(M.INT8, th)
        lat[f"ms_per_chip_int8_cpu_b64_t{th}"] = ms_per_chip(lambda: s.run(None, {"x": x}), 64)
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
    lat["ms_per_chip_int8_cpu_b64_best"] = min(v for k, v in lat.items() if k.startswith("ms_per_chip_int8_cpu_b64"))
    lat["load_avg_1m"] = __import__("os").getloadavg()[0] if hasattr(__import__("os"), "getloadavg") else None
    r = M.update_report({"latency": lat})
    print(lat)
    print("G4 (<1 ms/chip int8 b64):", "PASS" if lat["ms_per_chip_int8_cpu_b64_best"] < 1 else "FAIL")
    return 0
