"""Value model (PRD s8): pure functions, params from config/value.json."""
import json

from herald.paths import CONFIG


def load(path=CONFIG / "value.json"):
    """-> (params flat dict, queries list). Meta (assumption/source) stays in the json."""
    d = json.loads(path.read_text(encoding="utf-8"))
    return {k: v["value"] for k, v in d["params"].items()}, d["queries"]


def level_bytes(full_bytes, params):
    """Cumulative bytes per level [packet, thumb, full]; full forced > thumb so increments are > 0."""
    p, t = params["level_bytes"]
    return [p, t, max(int(full_bytes), t + 1)]


def match(tile, q):
    return tile["aoi"] in q["aois"] and tile["sev"] >= q["min_sev"]


def tile_value(tile, queries, params):
    """Rupees if the full chip reached the user fresh: sum over matching queries of
    p_rel x ha x rupees_per_ha[pack] x (1-cloud) x priority."""
    v = 0.0
    for q in queries:
        if match(tile, q):
            p = tile["pA"] if q["pack"] == "A" else tile["pC"]
            v += p * tile["ha"] * params["rupees_per_ha"][q["pack"]] * (1 - tile["cloud"]) * q["priority"]
    return v
