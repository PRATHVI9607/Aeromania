"""M3 onboard model: train / calibrate / export / score. `python -m herald <cmd>`; argv[0] is the command.

Backbone: torchgeo SSL4EO-S12 ResNet-18 (SENTINEL2_ALL_MOCO), conv1 sliced from 13 to our 5 bands.
Input x = (reflectance - mean)/std (models/norm.json); SSL4EO weights expect a different scaling,
fine-tuning absorbs the shift.
"""
import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

from herald import paths

CLASSES = ["AnnualCrop", "Forest", "HerbaceousVegetation", "Highway", "Industrial",
           "Pasture", "PermanentCrop", "Residential", "River", "SeaLake"]
# torchgeo EuroSAT data puts B8A last; SSL4EO weights use standard order (B8A at 8). Indices differ for B11.
DS13 = ["B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08", "B09", "B10", "B11", "B12", "B8A"]
W13 = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B8a", "B9", "B10", "B11", "B12"]
IDX_DS = [DS13.index(b) for b in paths.BANDS]  # [1,2,3,7,10]
IDX5 = [W13.index("B" + b[1:].lstrip("0")) for b in paths.BANDS]  # weights: [1,2,3,7,11]
DATA = paths.ROOT / "data" / "eurosat"
PT = paths.MODELS / "herald.pt"
NORM = paths.MODELS / "norm.json"
REPORT = paths.REPORTS / "model.json"
FP32, INT8 = paths.MODELS / "herald_fp32.onnx", paths.MODELS / "herald_int8.onnx"


# ---------- small helpers ----------
def ece(probs, labels, bins=15):
    """Expected calibration error, equal-width confidence bins."""
    probs, labels = np.asarray(probs), np.asarray(labels)
    conf, pred = probs.max(1), probs.argmax(1)
    edges, e = np.linspace(0, 1, bins + 1), 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (conf > lo) & (conf <= hi)
        if m.any():
            e += m.mean() * abs((pred[m] == labels[m]).mean() - conf[m].mean())
    return float(e)


def softmax(z):
    z = z - z.max(1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(1, keepdims=True)


def fit_temperature(logits, labels):
    import torch
    z, y = torch.tensor(logits, dtype=torch.float32), torch.tensor(labels)
    lt = torch.zeros(1, requires_grad=True)
    opt = torch.optim.LBFGS([lt], lr=0.1, max_iter=200)

    def closure():
        opt.zero_grad()
        loss = torch.nn.functional.cross_entropy(z / lt.exp(), y)
        loss.backward()
        return loss
    opt.step(closure)
    return float(lt.exp().detach())


def update_report(d):
    paths.ensure(paths.REPORTS)
    r = json.loads(REPORT.read_text(encoding="utf-8")) if REPORT.exists() else {}
    for k, v in d.items():
        r[k] = {**r.get(k, {}), **v} if isinstance(v, dict) and isinstance(r.get(k), dict) else v
    r["classes"] = CLASSES
    REPORT.write_text(json.dumps(r, indent=2), encoding="utf-8")
    return r


def get_norm():
    n = json.loads(NORM.read_text(encoding="utf-8"))
    return np.array(n["mean"], np.float32).reshape(1, 5, 1, 1), np.array(n["std"], np.float32).reshape(1, 5, 1, 1)


def prep(x_u16_or_dn):
    """DN (reflectance*10000) [N,5,H,W] -> normalized float32."""
    m, s = get_norm()
    return ((np.asarray(x_u16_or_dn, np.float32) / 10000.0 - m) / s).astype(np.float32)


# ---------- model ----------
def slice_conv1(w13):
    return w13[:, IDX5].clone()


def build_trunk(pretrained=True):
    """Returns (trunk module -> [B,512], backbone name). Ladder: SSL4EO -> timm ImageNet -> small CNN."""
    import torch
    from torch import nn
    if pretrained:
        try:
            from torchgeo.models import ResNet18_Weights, resnet18
            net = resnet18(weights=ResNet18_Weights.SENTINEL2_ALL_MOCO)
            w = slice_conv1(net.conv1.weight.data)
            net.conv1 = nn.Conv2d(5, 64, 7, 2, 3, bias=False)
            net.conv1.weight.data = w
            net.reset_classifier(0)
            return net, "SSL4EO-S12 ResNet-18 (torchgeo SENTINEL2_ALL_MOCO), conv1 sliced to B02,B03,B04,B08,B11"
        except Exception as e:  # noqa: BLE001
            print("SSL4EO load failed:", e, file=sys.stderr)
        try:
            import timm
            net = timm.create_model("resnet18", pretrained=True, num_classes=0, in_chans=5)
            return net, "timm resnet18 ImageNet (conv1 adapted to 5 bands)"
        except Exception as e:  # noqa: BLE001
            print("timm load failed:", e, file=sys.stderr)
    return small_cnn(), "small CNN from scratch"


def small_cnn():
    from torch import nn

    def blk(i, o):
        return nn.Sequential(nn.Conv2d(i, o, 3, padding=1, bias=False), nn.BatchNorm2d(o), nn.ReLU(), nn.MaxPool2d(2))
    return nn.Sequential(blk(5, 32), blk(32, 64), blk(64, 128), blk(128, 256), nn.AdaptiveAvgPool2d(1),
                         nn.Flatten(), nn.Linear(256, 512), nn.ReLU())


def make_model(pretrained=True, trunk=None):
    import torch
    from torch import nn

    class Herald(nn.Module):
        def __init__(self, trunk, name):
            super().__init__()
            self.trunk, self.backbone = trunk, name
            self.cls = nn.Linear(512, 10)
            self.cloud = nn.Sequential(nn.Linear(512, 64), nn.ReLU(), nn.Linear(64, 1))
            self.proj = nn.Linear(512, 64)

        def forward(self, x):
            f = self.trunk(x)
            return self.cls(f), torch.sigmoid(self.cloud(f)), nn.functional.normalize(self.proj(f), dim=1)

    return Herald(*(trunk if trunk else build_trunk(pretrained)))


def load_model(device="cpu"):
    import torch
    ck = torch.load(PT, map_location="cpu", weights_only=False)
    m = make_model(trunk=(_trunk_like(ck), ck["backbone"]))
    m.load_state_dict(ck["state"])
    return m.to(device).eval()


def _trunk_like(ck):
    """Rebuild trunk structure without downloading weights."""
    if ck["backbone"].startswith("small"):
        return small_cnn()
    import timm
    return timm.create_model("resnet18", pretrained=False, num_classes=0, in_chans=5)


def pick_device(d):
    import torch
    return "cuda" if d in ("auto", "cuda") and torch.cuda.is_available() else "cpu"


# ---------- data ----------
def eurosat(split):
    """-> (x uint16-ish float32 DN [N,5,64,64], y int64 [N]). Cached as npz."""
    cache = DATA / f"{split}_5b.npz"
    if cache.exists():
        z = np.load(cache)
        return z["x"], z["y"]
    from torchgeo.datasets import EuroSAT
    assert list(EuroSAT.all_band_names) == DS13, EuroSAT.all_band_names
    ds = EuroSAT(root=str(DATA), split=split, bands=tuple(EuroSAT.all_band_names), download=True)
    assert list(ds.classes if hasattr(ds, "classes") else CLASSES) == CLASSES
    xs, ys = [], []
    for i in range(len(ds)):
        s = ds[i]
        xs.append(s["image"].numpy()[IDX_DS].astype(np.float32))
        ys.append(int(s["label"]))
    x, y = np.stack(xs).astype(np.uint16), np.array(ys, np.int64)
    np.savez(cache, x=x, y=y)
    return x, y


def get_eurosat(split):
    x, y = eurosat(split)
    return x.astype(np.float32), y


# ---------- train ----------
def evaluate(model, x, y, dev, bs=512):
    import torch
    out = []
    model.eval()
    with torch.no_grad():
        for i in range(0, len(x), bs):
            xb = torch.from_numpy(prep(x[i:i + bs])).to(dev)
            with torch.autocast(dev, enabled=dev == "cuda"):
                out.append(model(xb)[0].float().cpu().numpy())
    lg = np.concatenate(out)
    return lg, float((lg.argmax(1) == y).mean())


def cmd_train(a):
    import torch
    from torch import nn
    dev = pick_device(a.device)
    tr, va = get_eurosat("train"), get_eurosat("val")
    paths.ensure(paths.MODELS)
    mean = (tr[0] / 10000).mean((0, 2, 3))
    std = (tr[0] / 10000).std((0, 2, 3))
    NORM.write_text(json.dumps({"bands": paths.BANDS, "mean": mean.tolist(), "std": std.tolist(),
                                "scale": "refl = DN/10000", "n_train": len(tr[1])}, indent=2), encoding="utf-8")
    model = make_model(not a.scratch).to(dev)
    print("backbone:", model.backbone, "device:", dev)
    xt = torch.from_numpy(prep(tr[0]))
    yt = torch.from_numpy(tr[1])
    bs = a.bs
    crit = nn.CrossEntropyLoss(label_smoothing=0.1)
    scaler = torch.amp.GradScaler(enabled=dev == "cuda")
    best, t0 = -1, time.time()
    total = a.frozen + a.epochs
    for ep in range(total):
        frozen = ep < a.frozen
        for p in model.trunk.parameters():
            p.requires_grad = not frozen
        if ep == 0:
            opt = torch.optim.AdamW([p for n, p in model.named_parameters() if not n.startswith("trunk")], lr=2e-3)
            sched = None
        if ep == a.frozen:
            head = [p for n, p in model.named_parameters() if not n.startswith("trunk")]
            opt = torch.optim.AdamW([{"params": model.trunk.parameters(), "lr": a.lr},
                                     {"params": head, "lr": a.lr * 3}], weight_decay=1e-2)
            sched = torch.optim.lr_scheduler.OneCycleLR(opt, [a.lr, a.lr * 3], total_steps=a.epochs * (len(yt) // bs),
                                                        pct_start=0.15)
        model.train()
        if frozen:
            model.trunk.eval()
        perm = torch.randperm(len(yt))
        for i in range(0, len(perm) - bs + 1, bs):
            idx = perm[i:i + bs]
            xb, yb = xt[idx].to(dev), yt[idx].to(dev)
            if torch.rand(1) < .5:
                xb = xb.flip(3)
            if torch.rand(1) < .5:
                xb = xb.flip(2)
            xb = torch.rot90(xb, int(torch.randint(0, 4, (1,))), (2, 3))
            with torch.autocast(dev, enabled=dev == "cuda"):
                loss = crit(model(xb)[0], yb)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
            if sched:
                sched.step()
        _, acc = evaluate(model, va[0], va[1], dev)
        print(f"ep {ep + 1}/{total} {'frozen' if frozen else 'full'} loss {loss.item():.3f} val {acc:.4f} t {time.time() - t0:.0f}s", flush=True)
        if acc > best and not frozen:
            best = acc
            torch.save({"state": model.state_dict(), "backbone": model.backbone, "val": acc}, PT)
    update_report({"backbone": model.backbone, "eurosat": {"val_top1_best": best, "train_s": round(time.time() - t0)}})
    print("best val", best)


# ---------- calibrate ----------
def cmd_calibrate(a):
    dev = pick_device(a.device)
    model = load_model(dev)
    if a.cloud:
        return cloud_stage(model, dev, a)
    va, te = get_eurosat("val"), get_eurosat("test")
    lv, _ = evaluate(model, *va, dev)
    lt, acc = evaluate(model, *te, dev)
    T = fit_temperature(lv, va[1])
    r = update_report({"eurosat": {"top1_fp32": acc, "ece_before": ece(softmax(lt), te[1]),
                                   "ece_after": ece(softmax(lt / T), te[1]), "temperature": T, "n_test": len(te[1])}})
    print(json.dumps(r["eurosat"], indent=2))


def cloud_labels(aoi):
    z = np.load(paths.LABELS / f"{aoi}.npz")
    return {k[6:]: z[k] for k in z.files if k.startswith("cloud_")}


def features(model, x, dev, bs=256):
    import torch
    out = []
    with torch.no_grad():
        for i in range(0, len(x), bs):
            xb = torch.from_numpy(prep(x[i:i + bs])).to(dev)
            out.append(model.trunk(xb).float().cpu())
    return torch.cat(out)


def fit_cloud(model, ftr, ytr, fte, yte, epochs=300):
    """Train ONLY model.cloud on frozen features; returns held-out MAE."""
    import torch
    opt = torch.optim.AdamW(model.cloud.parameters(), lr=3e-3, weight_decay=1e-3)
    for _ in range(epochs):
        for idx in torch.randperm(len(ytr)).split(1024):
            loss = torch.nn.functional.binary_cross_entropy_with_logits(model.cloud(ftr[idx].to(next(model.parameters()).device)).squeeze(1),
                                                                         ytr[idx].to(next(model.parameters()).device))
            opt.zero_grad()
            loss.backward()
            opt.step()
    with torch.no_grad():
        p = torch.sigmoid(model.cloud(fte.to(next(model.parameters()).device))).squeeze(1).cpu()
    return float((p - yte).abs().mean())


def cloud_stage(model, dev, a):
    import torch
    feats = {}
    for aoi in ("blr", "sone", "hasdeo"):
        lab = cloud_labels(aoi) if (paths.LABELS / f"{aoi}.npz").exists() else {}
        fs, ys = [], []
        for d, y in lab.items():
            f = paths.CHIPS / f"{aoi}_{d}.npy"
            if f.exists():
                fs.append(features(model, np.load(f, mmap_mode="r"), dev))
                ys.append(torch.from_numpy(y.astype(np.float32)))
        if fs:
            feats[aoi] = (torch.cat(fs), torch.cat(ys))
    if not {"blr", "sone", "hasdeo"} <= feats.keys():
        print("cloud stage PENDING: vault chips/labels for blr,sone,hasdeo not all present", file=sys.stderr)
        return 1
    ftr = torch.cat([feats["blr"][0], feats["sone"][0]])
    ytr = torch.cat([feats["blr"][1], feats["sone"][1]])
    for p in model.parameters():
        p.requires_grad = False
    for p in model.cloud.parameters():
        p.requires_grad = True
    mae = fit_cloud(model, ftr, ytr, *feats["hasdeo"])
    ck = torch.load(PT, map_location="cpu", weights_only=False)
    ck["state"] = {k: v.cpu() for k, v in model.state_dict().items()}
    torch.save(ck, PT)
    update_report({"cloud": {"mae": mae, "heldout_aoi": "hasdeo", "train_aois": ["blr", "sone"],
                             "mean_baseline_mae": float((feats["hasdeo"][1] - ytr.mean()).abs().mean())}})
    print("cloud MAE hasdeo", mae)
    return 0


# ---------- export ----------
class Calib:
    def __init__(self, x, bs=32):
        self.x, self.bs, self.i = x, bs, 0

    def get_next(self):
        if self.i >= len(self.x):
            return None
        b = self.x[self.i:self.i + self.bs]
        self.i += self.bs
        return {"x": b}

    rewind = lambda self: setattr(self, "i", 0)  # noqa: E731


def export_onnx(model, path):
    import torch
    model = model.cpu().eval()
    torch.onnx.export(model, torch.zeros(1, 5, 64, 64), str(path), opset_version=17, dynamo=False,
                      input_names=["x"], output_names=["logits", "cloud", "emb"],
                      dynamic_axes={k: {0: "b"} for k in ("x", "logits", "cloud", "emb")})


def quantize(fp32, int8, calib):
    from onnxruntime.quantization import (CalibrationDataReader, QuantFormat, QuantType, quantize_static,
                                          quant_pre_process)
    pre = Path(str(fp32) + ".pre")
    try:
        quant_pre_process(str(fp32), str(pre))
        src = pre
    except Exception:  # noqa: BLE001
        src = fp32

    class R(Calib, CalibrationDataReader):
        pass
    quantize_static(str(src), str(int8), R(calib), quant_format=QuantFormat.QOperator, per_channel=True,
                    activation_type=QuantType.QUInt8, weight_type=QuantType.QInt8,
                    extra_options={"ActivationSymmetric": False})  # QOperator not QDQ: ~2x faster on ORT CPU, same accuracy
    pre.unlink(missing_ok=True)


def ort_session(path, threads=None):
    import onnxruntime as ort
    so = ort.SessionOptions()
    if threads:
        so.intra_op_num_threads = threads
    return ort.InferenceSession(str(path), so, providers=["CPUExecutionProvider"])


def ort_run(sess, x, bs=64):
    outs = [sess.run(None, {"x": x[i:i + bs]}) for i in range(0, len(x), bs)]
    return [np.concatenate(o) for o in zip(*outs)]


def cmd_export(a):
    model = load_model("cpu")
    export_onnx(model, FP32)
    tr = get_eurosat("train")
    rng = np.random.default_rng(0)
    cal = [tr[0][rng.choice(len(tr[1]), 384, replace=False)]]
    for f in [p for p in paths.CHIPS.glob("*.npy") if not p.stem.endswith("_scl")] if paths.CHIPS.exists() else []:
        arr = np.load(f, mmap_mode="r")
        cal.append(np.asarray(arr[rng.choice(len(arr), min(16, len(arr)), replace=False)]))
    cal = prep(np.concatenate(cal))[rng.permutation(sum(len(c) for c in cal))]
    print("calibration chips:", len(cal))
    quantize(FP32, INT8, cal)
    te = get_eurosat("test")
    xt = prep(te[0])
    acc = {k: float((ort_run(ort_session(p), xt)[0].argmax(1) == te[1]).mean()) for k, p in (("fp32", FP32), ("int8", INT8))}
    r = update_report({"eurosat": {"top1_onnx_fp32": acc["fp32"], "top1_int8": acc["int8"],
                                   "int8_drop_pt": 100 * (acc["fp32"] - acc["int8"])},
                       "onnx": {"calib_chips": len(cal), "int8_mb": round(INT8.stat().st_size / 1e6, 2)}})
    print(json.dumps(r["eurosat"], indent=2))


# ---------- score ----------
def cmd_score(a):
    files = [p for p in paths.CHIPS.glob("*.npy") if not p.stem.endswith("_scl")] if paths.CHIPS.exists() else []
    if not files:
        print("vault/chips missing: nothing to score", file=sys.stderr)
        return 0
    T = json.loads(REPORT.read_text(encoding="utf-8"))["eurosat"]["temperature"]
    sess = ort_session(INT8)
    paths.ensure(paths.SCORES)
    for f in sorted(files):
        lg, cl, emb = ort_run(sess, prep(np.load(f)))
        np.savez(paths.SCORES / f"{f.stem}.npz", probs=softmax(lg / T).astype(np.float32),
                 cloud=cl[:, 0].astype(np.float32), emb=emb.astype(np.float16))
        print("scored", f.stem, flush=True)
    return 0


def main(argv):
    ap = argparse.ArgumentParser(prog="herald " + argv[0])
    ap.add_argument("--device", default="auto")
    ap.add_argument("--epochs", type=int, default=10)
    ap.add_argument("--frozen", type=int, default=1)
    ap.add_argument("--lr", type=float, default=5e-4)
    ap.add_argument("--bs", type=int, default=128)
    ap.add_argument("--scratch", action="store_true")
    ap.add_argument("--cloud", action="store_true")
    a = ap.parse_args(argv[1:])
    return {"train": cmd_train, "calibrate": cmd_calibrate, "export": cmd_export, "score": cmd_score}[argv[0]](a)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]) or 0)
