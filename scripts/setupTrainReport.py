"""Sums up the runs of scripts/setupTrain.ts.

    python scripts/setupTrainReport.py node_modules/.cache/setupTrain

Per circuit and setup: the mean full-race time of the models trained on that
setup (each timed on its own setup), and how the same models fare on the other
setups. The first table answers "does the setup change the result"; the
second separates a faster car from a model that learned its car.
"""
import json
import os
import statistics
import sys
from collections import defaultdict

folder = sys.argv[1]
runs = []
for name in sorted(os.listdir(folder)):
    with open(os.path.join(folder, name), encoding="utf-8") as f:
        text = f.read().strip()
    if text:
        runs.append(json.loads(text.splitlines()[-1]))

SETUPS = ["balanced", "downforce", "lowdrag"]
tracks = sorted({r["trackId"] for r in runs})


def fmt(v):
    return "   DNF " if v is None else f"{v / 1000:7.2f}"


print("Race time (s), models trained and raced on each setup - mean of seeds [each seed]")
print(f"{'circuit':10} " + " ".join(f"{s:>24}" for s in SETUPS) + "   fastest")
for t in tracks:
    cells = []
    means = {}
    for s in SETUPS:
        times = [r["raceMs"] for r in runs if r["trackId"] == t and r["setup"] == s]
        ok = [x for x in times if x is not None]
        means[s] = statistics.mean(ok) if ok else None
        cells.append(f"{fmt(means[s])} [{' '.join(fmt(x).strip() for x in times)}]".rjust(24))
    best = min((s for s in SETUPS if means[s] is not None), key=lambda s: means[s], default="-")
    print(f"{t:10} " + " ".join(cells) + f"   {best}")

print("\nSame weights, other cars: rows = setup trained on, columns = setup raced on (mean race time)")
for t in tracks:
    print(f"\n{t}")
    print(f"{'trained on':12} " + " ".join(f"{s:>10}" for s in SETUPS))
    for trained in SETUPS:
        row = []
        for raced in SETUPS:
            xs = [r["onOthers"][raced]["raceMs"] for r in runs if r["trackId"] == t and r["setup"] == trained]
            ok = [x for x in xs if x is not None]
            row.append(fmt(statistics.mean(ok)) if len(ok) == len(xs) and ok else "   DNF ")
        print(f"{trained:12} " + " ".join(f"{c:>10}" for c in row))
