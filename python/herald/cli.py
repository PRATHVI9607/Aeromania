"""`python -m herald <cmd> [args]`. Each command maps to a module exposing main(argv) -> int.

argv passed to the module starts with the command name, e.g. ["train", "--epochs", "3"].
Add a command by adding one line to COMMANDS; never edit modules' argument parsing here.
"""
import importlib
import sys

COMMANDS = {
    "orbit": "orbit",        # windows.json, track.json
    "vault": "vault",        # vault build|verify|pack
    "labels": "labels",      # SCL cloud, WorldCover, OSM construction
    "train": "model",        # fine-tune EuroSAT + heads
    "calibrate": "model",    # temperature scaling + cloud head fit
    "export": "model",       # ONNX + int8
    "score": "model",        # run int8 model over vault chips
    "change": "change",      # change engine + validation
    "sim": "sim",            # capture timeline -> schedule -> results.json
    "bench": "bench",        # latency / accuracy report
    "evidence": "evidence",  # hash-chained evidence cards
    "economics": "economics",
    "all": "pipeline",       # run everything in order
}


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] not in COMMANDS:
        print("usage: python -m herald <" + "|".join(COMMANDS) + "> [args]")
        return 2
    mod = importlib.import_module(f"herald.{COMMANDS[argv[0]]}")
    return int(mod.main(argv) or 0)
