#!/usr/bin/env python3
"""Fotogrammi di verifica dai montaggi finali (orizzontale e verticale).

Estrae un frame per punto-chiave della timeline in webrec/check/final/ e
compone anche una strip riassuntiva per il colpo d'occhio."""
import os, subprocess, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "webrec", "check", "final")
os.makedirs(OUT, exist_ok=True)

# Tempi tarati sulla timeline ~73 s della versione finale: un frame per
# scena + i punti critici (didascalie, badge punteggio, stacco webpages).
TIMES = [1.5, 5.5, 10, 14.5, 17.5, 20.5, 24, 26.5, 30, 35, 39, 45, 50,
         52.5, 55.5, 59, 64.5, 70, 72.8]
JOBS = {
    "h": ("jht-show-sober.mp4", TIMES),
    "v": ("jht-show-vertical-sober.mp4", TIMES),
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
