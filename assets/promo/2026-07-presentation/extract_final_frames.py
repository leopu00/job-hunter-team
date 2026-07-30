#!/usr/bin/env python3
"""Fotogrammi di verifica dai montaggi finali (orizzontale e verticale).

Estrae un frame per punto-chiave della timeline in webrec/check/final/ e
compone anche una strip riassuntiva per il colpo d'occhio."""
import os, subprocess, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "webrec", "check", "final")
os.makedirs(OUT, exist_ok=True)

JOBS = {
    "h": ("jht-show-warm.mp4",
          [1.5, 5, 8, 12, 14.5, 16.5, 19, 25, 29, 33, 39, 43, 45.5, 47.5,
           50, 54, 59]),
    "v": ("jht-show-vertical-warm.mp4",
          [1.5, 5, 8, 12, 14.5, 16.5, 19, 25, 29, 33, 39, 43, 45.5, 47.5,
           50, 54, 59]),
}

wanted = sys.argv[1:] or ["h"]
for key in wanted:
    src, times = JOBS[key]
    path = os.path.join(ROOT, src)
    if not os.path.isfile(path):
        print(f"salto {key}: manca {src}")
        continue
    for t in times:
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-ss", str(t), "-i", path,
             "-frames:v", "1", os.path.join(OUT, f"{key}_{t}.png")],
            check=True)
    print(f"{key}: {len(times)} frame in {OUT}")
