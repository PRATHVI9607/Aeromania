import numpy as np
import pytest

from herald import model as M


def test_ece_known():
    p = np.array([[0.9, 0.1]] * 10)
    assert M.ece(p, np.array([0] * 9 + [1])) == pytest.approx(0.0, abs=1e-9)
    assert M.ece(p, np.array([1] * 10)) == pytest.approx(0.9)


def test_band_idx():
    assert M.IDX5 == [1, 2, 3, 7, 11] and M.IDX_DS == [1, 2, 3, 7, 10]


def test_conv1_slice():
    torch = pytest.importorskip("torch")
    w = torch.randn(64, 13, 7, 7)
    s = M.slice_conv1(w)
    assert s.shape == (64, 5, 7, 7) and torch.equal(s[:, 3], w[:, 7])


def test_forward_and_onnx_roundtrip(tmp_path):
    torch = pytest.importorskip("torch")
    ort = pytest.importorskip("onnxruntime")
    m = M.make_model(trunk=(M.small_cnn(), "small")).eval()
    x = torch.randn(3, 5, 64, 64)
    lg, cl, emb = m(x)
    assert lg.shape == (3, 10) and cl.shape == (3, 1) and emb.shape == (3, 64)
    assert torch.allclose(emb.norm(dim=1), torch.ones(3), atol=1e-4) and ((cl >= 0) & (cl <= 1)).all()
    M.export_onnx(m, tmp_path / "t.onnx")
    o = M.ort_session(tmp_path / "t.onnx").run(None, {"x": x.numpy()})
    assert [a.shape for a in o] == [(3, 10), (3, 1), (3, 64)]
    assert np.allclose(o[0], lg.detach().numpy(), atol=1e-3)


def test_fit_cloud_synthetic():
    torch = pytest.importorskip("torch")
    m = M.make_model(trunk=(M.small_cnn(), "small"))
    f = torch.randn(3000, 512)
    y = torch.sigmoid(f[:, 0])
    mae = M.fit_cloud(m, f[:2400], y[:2400], f[2400:], y[2400:], epochs=40)
    assert mae < 0.9 * float((y[2400:] - y[:2400].mean()).abs().mean())  # beats constant baseline
