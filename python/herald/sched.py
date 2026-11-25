"""Downlink scheduler (PRD s10). Pure python, O(n log n), deterministic (ties by tile index).

Online, window by window: only tiles captured at or before the window start are eligible.
Window capacity = total_capacity * dur / total_dur, total_capacity = archive_bytes / rho.
Realized value of a send = V * dfrac * 0.5 ** ((window_end - t_cap) / 60 / half_life_h).
Policies: B1 FIFO | B2 drop cloud>cloud_drop + FIFO | B3 value-desc full chips |
H1 value/byte full chips | H2 progressive packet->thumb->full by marginal value/byte, full only if V >= pull_threshold.
A does-not-fit item is skipped (up to LOOKAHEAD per window) and stays queued for later windows. Shortcut: heap keys ignore decay (it is
common to all items within a window except via t_cap), upgrade if freshness-aware ordering matters.
"""
import heapq

from herald.value import level_bytes, tile_value

LOOKAHEAD = 8   # a window gives up after this many consecutive does-not-fit items (keeps O(n log n))
POLICIES = ["B1", "B2", "B3", "H1", "H2"]


def prepare(tiles, queries, params):
    V = [tile_value(t, queries, params) for t in tiles]
    B = [level_bytes(t["full_bytes"], params) for t in tiles]
    return V, B


def capacities(windows, tiles, params, rho, B):
    total = sum(b[2] for b in B) / rho
    dur = sum(w["end_min"] - w["start_min"] for w in windows)
    return [total * (w["end_min"] - w["start_min"]) / dur for w in windows], total


def upper_bound(V, B, params, total_cap):
    """Fractional knapsack over level increments (no decay, no timing, total capacity). Upper bound, not optimum."""
    fr = params["level_fraction"]
    items = []
    for i, v in enumerate(V):
        if v <= 0:
            continue
        prev_b, prev_f = 0, 0.0
        for L in range(3):
            db, df = B[i][L] - prev_b, fr[L] - prev_f
            items.append((-(v * df / db), i, L, v * df, db))
            prev_b, prev_f = B[i][L], fr[L]
    items.sort()
    left, val = total_cap, 0.0
    for _, _, _, dv, db in items:
        if left <= 0:
            break
        x = min(1.0, left / db)
        val += dv * x
        left -= db * x
    return val


def run(policy, tiles, windows, params, queries, rho, prep=None):
    """-> dict(sel=[(tile, level, window_idx)], metrics, timeline). `windows`: start_min,end_min sorted by start."""
    V, B = prep or prepare(tiles, queries, params)
    fr, hl = params["level_fraction"], params["half_life_h"]
    caps, total = capacities(windows, tiles, params, rho, B)
    n = len(tiles)
    steps = (0, 1, 2) if policy == "H2" else (2,)
    pull = params["pull_threshold"]
    min_inc = min(b[0] if policy == "H2" else b[2] for b in B) if B else 0

    def entry(i, L):
        """Heap entry for sending tile i up to level L, or None if never sent."""
        v, t = V[i], tiles[i]
        if policy == "B1":
            k = t["t_cap_min"]
        elif policy == "B2":
            if t["cloud"] > params["cloud_drop"]:
                return None
            k = t["t_cap_min"]
        elif v <= 0 or (L == 2 and policy == "H2" and v < pull):
            return None
        elif policy == "B3":
            k = -v
        else:
            pb, pf = (B[i][L - 1], fr[L - 1]) if L and policy == "H2" else (0, 0.0)
            k = -(v * (fr[L] - pf) / (B[i][L] - pb))
        return (k, i, L)

    order = sorted(range(n), key=lambda i: (tiles[i]["t_cap_min"], i))
    ptr, heap, sel = 0, [], []
    target = 0.9 * sum(V)
    cum_raw = cum_val = cum_bytes = cloud_bytes = 0.0
    minutes, first_min, ttfi = 0.0, None, None
    tl = {"bytes": [], "value": [], "cum_value": [], "cloud_bytes": [], "cap": []}
    level = [-1] * n
    for w, win in enumerate(windows):
        while ptr < n and tiles[order[ptr]]["t_cap_min"] <= win["start_min"]:
            e = entry(order[ptr], steps[0])
            if e:
                heapq.heappush(heap, e)
            ptr += 1
        left, skipped, wb, wv, wc = caps[w], [], 0.0, 0.0, 0.0
        dur = win["end_min"] - win["start_min"]
        while heap and left >= min_inc:
            e = heapq.heappop(heap)
            _, i, L = e
            inc = B[i][L] - (B[i][L - 1] if L and policy == "H2" else 0)
            if inc > left:
                skipped.append(e)
                if len(skipped) >= LOOKAHEAD:
                    break
                continue
            left -= inc
            df = fr[L] - (fr[L - 1] if L and policy == "H2" else 0.0)
            dv = V[i] * df
            real = dv * 0.5 ** ((win["end_min"] - tiles[i]["t_cap_min"]) / 60 / hl)
            wb += inc
            wv += real
            cum_raw += dv
            if tiles[i]["cloud"] > 0.5:
                wc += inc
            if V[i] > 0 and ttfi is None:
                ttfi = win["end_min"] - tiles[i]["t_cap_min"]
            if first_min is None and target > 0 and cum_raw >= target:
                first_min = minutes + dur * (caps[w] - left) / caps[w]
            sel.append((i, L, w))
            level[i] = L
            if policy == "H2" and L < 2:
                nxt = entry(i, L + 1)
                if nxt:
                    heapq.heappush(heap, nxt)
        for e in skipped:
            heapq.heappush(heap, e)
        minutes += dur
        cum_val += wv
        cum_bytes += wb
        cloud_bytes += wc
        for k, x in zip(tl, (wb, wv, cum_val, wc, caps[w]), strict=True):
            tl[k].append(x)
    ub = upper_bound(V, B, params, total)
    return {"sel": sel, "level": level, "timeline": tl, "metrics": {
        "value": cum_val, "ub": ub, "pct_ub": cum_val / ub if ub else None,
        "minutes_to_90": first_min, "ttfi_min": ttfi, "bytes_sent": cum_bytes,
        "cloud_bytes": cloud_bytes, "capacity_bytes": total, "total_value": sum(V)}}
