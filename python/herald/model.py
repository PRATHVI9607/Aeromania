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

WC_CLASSES = ['Tree', 'Shrub', 'Grass', 'Crop', 'Built', 'Bare', 'Snow', 'Water', 'Wetland', 'Mangrove', 'Moss']  # ESA WorldCover codes 10,20,...,90,95,100
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


def cloud_head():
    from torch import nn
    return nn.Sequential(nn.Linear(512, 64), nn.ReLU(), nn.Linear(64, 1))


def make_model(pretrained=True, trunk=None):
    import torch
    from torch import nn

    class Herald(nn.Module):
        def __init__(self, trunk, name):
            super().__init__()
            self.trunk, self.backbone = trunk, name
            self.cls = nn.Linear(512, 10)
            self.cloud = cloud_head()
            self.wc = nn.Sequential(nn.Linear(512, 128), nn.ReLU(), nn.Linear(128, 11))
            self.proj = nn.Linear(512, 64)

        def forward(self, x):
            f = self.trunk(x)
            return (self.cls(f), torch.sigmoid(self.cloud(f)), nn.functional.normalize(self.proj(f), dim=1),
                    torch.softmax(self.wc(f), 1))

    return Herald(*(trunk if trunk else build_trunk(pretrained)))


def load_model(device="cpu"):
    import torch
    ck = torch.load(PT, map_location="cpu", weights_only=False)
    m = make_model(trunk=(_trunk_like(ck), ck["backbone"]))
    m.load_state_dict(ck["state"], strict=False)  # old checkpoints lack the wc head
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
    if a.wc:
        return wc_stage(model, dev, a)
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
    """Train ONLY model.cloud (re-initialised) on frozen features; returns held-out MAE."""
    import torch
    dev = next(model.parameters()).device
    model.cloud = cloud_head().to(dev)
    opt = torch.optim.AdamW(model.cloud.parameters(), lr=3e-3, weight_decay=1e-3)
    for _ in range(epochs):
        for idx in torch.randperm(len(ytr)).split(1024):
            loss = torch.nn.functional.binary_cross_entropy_with_logits(model.cloud(ftr[idx].to(dev)).squeeze(1), ytr[idx].to(dev))
            opt.zero_grad()
            loss.backward()
            opt.step()
    with torch.no_grad():
        p = torch.sigmoid(model.cloud(fte.to(dev))).squeeze(1).cpu()
    return float((p - yte).abs().mean())


def scene_feats(model, dev):
    """{(aoi, date): (trunk feats [N,512], cloud frac [N] from SCL classes 3,8,9,10, wc [N,11] or None)} for every vault scene."""
    import torch
    out = {}
    for f in sorted(paths.CHIPS.glob("*_scl.npy")):
        aoi, d = f.stem[:-4].split("_")
        if aoi not in ("blr", "sone", "hasdeo") or not (paths.CHIPS / f"{aoi}_{d}.npy").exists():
            continue
        cl = np.isin(np.load(f), (3, 8, 9, 10)).mean((1, 2)).astype(np.float32)
        wc = np.load(paths.LABELS / f"{aoi}.npz")["wc"] if (paths.LABELS / f"{aoi}.npz").exists() else None
        out[aoi, d] = (features(model, np.load(paths.CHIPS / f"{aoi}_{d}.npy", mmap_mode="r"), dev), torch.from_numpy(cl), wc)
    return out


def cloud_stage(model, dev, a):
    """Cloud head on frozen trunk. Headline: train blr+sone (all scenes incl. x1/x2) -> test hasdeo; plus leave-one-AOI-out folds."""
    import torch
    sf = scene_feats(model, dev)
    aois = sorted({k[0] for k in sf})
    if aois != ["blr", "hasdeo", "sone"]:
        print("cloud stage PENDING: vault chips for blr,sone,hasdeo not all present", file=sys.stderr)
        return 1
    for p in model.parameters():
        p.requires_grad = False

    def cat(keys):
        return torch.cat([sf[k][0] for k in keys]), torch.cat([sf[k][1] for k in keys])
    for p in model.cloud.parameters():
        p.requires_grad = True
    isx = lambda k: k[1].startswith("x")  # noqa: E731
    out = {v: {} for v in ("A_without_x", "B_with_x")}
    states = {}
    for ho in aois:
        te_i = [k for k in sf if k[0] == ho and not isx(k)]
        te_x = [k for k in sf if k[0] == ho and isx(k)]
        for var in out:
            tr = [k for k in sf if k[0] != ho and (var == "B_with_x" or not isx(k))]
            ftr, ytr = cat(tr)
            fit_cloud(model, ftr, ytr, *cat(te_i[:1]))  # trains head; MAE below is computed per test set
            states[var, ho] = {k: v.clone() for k, v in model.cloud.state_dict().items()}
            dev_ = next(model.parameters()).device
            r = {}
            for name, ks in (("original_dates", te_i), ("x1_x2_cirrus", te_x), ("combined", te_i + te_x)):
                f, y = cat(ks)
                with torch.no_grad():
                    r[name] = float((torch.sigmoid(model.cloud(f.to(dev_))).squeeze(1).cpu() - y).abs().mean())
            r["mean_baseline_combined"] = float((cat(te_i + te_x)[1] - ytr.mean()).abs().mean())
            out[var][ho] = r
            print("cloud", var, ho, {k: round(v, 3) for k, v in r.items()}, flush=True)
    score_ = {v: float(np.mean([out[v][h]["combined"] for h in aois])) for v in out}
    best = min(score_, key=score_.get)
    model.cloud.load_state_dict(states[best, "hasdeo"])  # head trained on blr+sone, held-out hasdeo
    ck = torch.load(PT, map_location="cpu", weights_only=False)
    ck["state"] = {k: v.cpu() for k, v in model.state_dict().items()}
    torch.save(ck, PT)
    h = out[best]["hasdeo"]
    update_report({"cloud": {"mae": h["combined"], "mae_original_dates": h["original_dates"], "mae_x1_x2_cirrus": h["x1_x2_cirrus"],
                             "heldout_aoi": "hasdeo", "train_aois": ["blr", "sone"], "kept_variant": best,
                             "mean_fold_combined_mae": score_, "loao": out,
                             "scenes_used": sorted(f"{k[0]}_{k[1]}" for k in sf), "labels": "SCL classes 3,8,9,10 fraction"}})
    print("cloud kept", best, h)
    return 0


def wc_stage(model, dev, a):
    """WorldCover head on frozen trunk (EuroSAT outputs untouched). Soft-CE on clear chips (cloud<0.1); test = eastern third of chip columns."""
    import torch
    F = torch.nn.functional
    sf = scene_feats(model, dev)
    if not sf or any(v[2] is None for v in sf.values()):
        print("wc stage PENDING: vault labels missing", file=sys.stderr)
        return 1
    for p in model.parameters():
        p.requires_grad = False
    col = np.arange(46 * 46) % 46
    X = {"tr": [], "te": []}
    meta = {"tr": [], "te": []}
    for (aoi, d), (f, cl, wc) in sf.items():
        clear = (cl.numpy() < 0.1)
        for name, m in (("tr", clear & (col < 29)), ("te", clear & (col >= 31))):  # cols 29-30 = buffer
            X[name].append((f[m], torch.from_numpy(wc[m])))
            meta[name] += [aoi] * int(m.sum())
    ftr, ytr = (torch.cat(z) for z in zip(*X["tr"]))
    fte, yte = (torch.cat(z) for z in zip(*X["te"]))
    aoi_te = np.array(meta["te"])
    for p in model.wc.parameters():
        p.requires_grad = True
    opt = torch.optim.AdamW(model.wc.parameters(), lr=2e-3, weight_decay=1e-2)

    for ep in range(60):
        for idx in torch.randperm(len(ytr)).split(512):
            lp = F.log_softmax(model.wc(ftr[idx].to(dev)), 1)
            loss = -(ytr[idx].to(dev) * lp).sum(1).mean()
            opt.zero_grad()
            loss.backward()
            opt.step()
    with torch.no_grad():
        P = torch.softmax(model.wc(fte.to(dev)), 1).cpu().numpy()
    T = yte.numpy()
    pt, tt = P.argmax(1), T.argmax(1)
    base = np.bincount(ytr.argmax(1).numpy(), minlength=11).argmax()
    present = [c for c in range(11) if (tt == c).any() or (pt == c).any()]
    conf = {WC_CLASSES[c]: {"n_true_dominant": int((tt == c).sum()), "recall": float((pt[tt == c] == c).mean()) if (tt == c).any() else None,
                            "predicted_as": {WC_CLASSES[j]: int(((tt == c) & (pt == j)).sum()) for j in present if ((tt == c) & (pt == j)).any()}}
            for c in present if (tt == c).any()}
    per = {aoi: {"n": int((aoi_te == aoi).sum()), "top1_agreement": float((pt == tt)[aoi_te == aoi].mean()),
                 "mean_l1": float(np.abs(P - T).sum(1)[aoi_te == aoi].mean())} for aoi in sorted(set(aoi_te))}
    res = {"top1_agreement": float((pt == tt).mean()), "mean_l1": float(np.abs(P - T).sum(1).mean()),
           "baseline_top1_majority": float((tt == base).mean()),
           "baseline_l1_mean_fractions": float(np.abs(ytr.mean(0).numpy() - T).sum(1).mean()),
           "n_train": len(ytr), "n_test": len(yte), "per_aoi": per, "confusion": conf, "classes": WC_CLASSES,
           "split": "test = chip columns >= 31 of 46 (eastern third), columns 29-30 dropped as buffer; clear chips cloud<0.1 all dates",
           "head": "MLP 512-128-11 on frozen trunk, soft cross-entropy; EuroSAT outputs unchanged",
           "caveat": "ESA WorldCover 2021 is ~77% accurate globally; targets are 10 m labels aggregated to chips, same date for all scenes of an AOI"}
    ck = torch.load(PT, map_location="cpu", weights_only=False)
    ck["state"] = {k: v.cpu() for k, v in model.state_dict().items()}
    torch.save(ck, PT)
    update_report({"wc": res})
    print(json.dumps({k: v for k, v in res.items() if k not in ("confusion",)}, indent=1))
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
                      input_names=["x"], output_names=["logits", "cloud", "emb", "wc"],
                      dynamic_axes={k: {0: "b"} for k in ("x", "logits", "cloud", "emb", "wc")})


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
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
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


# ---------- onboard embedding change score ----------
def echg_of(e, ref):
    """1 - cosine(e, ref) per row; embeddings are already L2-normalized, renormalize anyway (fp16 ref)."""
    e, ref = e.astype(np.float32), ref.astype(np.float32)
    n = np.linalg.norm(e, axis=1) * np.linalg.norm(ref, axis=1)
    return (1 - (e * ref).sum(1) / np.maximum(n, 1e-9)).astype(np.float32)


def cmd_change(a):
    """Reference = t0 embedding (fp16, 128 B/tile). echg saved into vault/scores/{aoi}_{date}.npz; eval on blr t0->t1."""
    from scipy.stats import spearmanr
    from sklearn.metrics import roc_auc_score
    from herald import change as ch
    done = {}
    for ref_f in sorted(paths.SCORES.glob("*_t0.npz")):
        aoi = ref_f.stem[:-3]
        ref = np.load(ref_f)["emb"]
        for d in ("c1", "t1", "c2"):
            f = paths.SCORES / f"{aoi}_{d}.npz"
            if f.exists():
                z = dict(np.load(f))
                z["echg"] = echg_of(z["emb"], ref)
                np.savez(f, **z)
                done[f"{aoi}_{d}"] = float(z["echg"].mean())
    print("echg written:", done)
    cj = paths.REPORTS / "change_blr.json"
    if "blr_t1" not in done or not cj.exists():
        print("blr eval skipped: need blr scores + reports/change_blr.json", file=sys.stderr)
        return 1
    tiles = json.loads(cj.read_text(encoding="utf-8"))["tiles"]
    ha = np.array([t["ha"] for t in tiles], np.float32)
    ok = np.array([t["valid"] for t in tiles])
    e = np.load(paths.SCORES / "blr_t1.npz")["echg"]
    m = ok & ((ha >= 1) | (ha == 0))
    res = {"auc_vs_rules": float(roc_auc_score(ha[m] >= 1, e[m])), "spearman": float(spearmanr(e[ok], ha[ok])[0]),
           "n_pos_ha_ge_1": int((ok & (ha >= 1)).sum()), "n_neg_ha_0": int((ok & (ha == 0)).sum()),
           "caveat": "reference is the rule-based detector (weak label), not ground truth; blr t0->t1 is a clean pair, cloud not masked",
           "ref_bytes_per_tile": 128, "ref_kb_per_aoi": 128 * 2116 / 1024}
    # injected patches: real built/bare pixels (as in change.injected_test) painted into 200 unchanged valid t1 chips
    rng = np.random.default_rng(11)
    x0 = np.load(paths.CHIPS / "blr_t0.npy")
    x1 = np.load(paths.CHIPS / "blr_t1.npy")
    r1 = x1.transpose(1, 0, 2, 3).reshape(5, -1).astype(np.float32) / 1e4
    ix = ch.indices(r1)
    pool = x1.transpose(1, 0, 2, 3).reshape(5, -1)[:, (ix["ndbi"] > 0.05) & (ix["ndvi"] < 0.15) & (ix["mndwi"] < 0)]
    pool = pool[:, rng.choice(pool.shape[1], min(pool.shape[1], 200000), replace=False)]
    cand = rng.choice(np.flatnonzero(ok & (ha == 0)), 200, replace=False)
    sess, ref = ort_session(INT8), np.load(paths.SCORES / "blr_t0.npz")["emb"][cand]
    clean = echg_of(ort_run(sess, prep(x1[cand]))[2], ref)
    inj = {}
    for h in ch.SIZES_HA:
        side = max(2, int(round(np.sqrt(h * 100))))
        xp = x1[cand].copy()
        for k in range(len(cand)):
            y, x = (int(v) for v in rng.integers(0, ch.C - side + 1, 2))
            xp[k, :, y:y + side, x:x + side] = pool[:, rng.integers(0, pool.shape[1], side * side)].reshape(5, side, side)
        pe = echg_of(ort_run(sess, prep(xp))[2], ref)
        inj[str(h)] = float(roc_auc_score(np.r_[np.zeros(len(cand)), np.ones(len(cand))], np.r_[clean, pe]))
    res["injected_auc_by_ha"] = inj
    res["injected_note"] = "200 unchanged valid blr t1 chips; patched vs same chips unpatched; real built/bare spectra, no spatial texture"
    res["audit_auc"] = "not run: reports/audit_blr.json absent" if not (paths.REPORTS / "audit_blr.json").exists() else "TODO"
    update_report({"embedding_change": res})
    print(json.dumps(res, indent=2))
    return 0


# ---------- score ----------
def cmd_score(a):
    if a.change:
        return cmd_change(a)
    files = [p for p in paths.CHIPS.glob("*.npy") if not p.stem.endswith("_scl")] if paths.CHIPS.exists() else []
    if not files:
        print("vault/chips missing: nothing to score", file=sys.stderr)
        return 0
    T = json.loads(REPORT.read_text(encoding="utf-8"))["eurosat"]["temperature"]
    sess = ort_session(INT8)
    paths.ensure(paths.SCORES)
    for f in sorted(files):
        lg, cl, emb, wc = ort_run(sess, prep(np.load(f)))
        np.savez(paths.SCORES / f"{f.stem}.npz", probs=softmax(lg / T).astype(np.float32),
                 cloud=cl[:, 0].astype(np.float32), emb=emb.astype(np.float16), wc=wc.astype(np.float32))
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
    ap.add_argument("--wc", action="store_true")
    ap.add_argument("--change", action="store_true")
    a = ap.parse_args(argv[1:])
    return {"train": cmd_train, "calibrate": cmd_calibrate, "export": cmd_export, "score": cmd_score}[argv[0]](a)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]) or 0)
