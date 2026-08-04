#!/usr/bin/env python3
"""Fotogrammi di verifica dai montaggi finali (orizzontale e verticale).

Estrae un frame per punto-chiave della timeline in webrec/check/final/.
I tempi coprono ogni scena del montaggio «Now Playable» (~75,5 s) più i
punti critici della regia: i clic del puntatore (onde visibili), le
vignette di gioco, l'88 su gioco/scheda/swipe, i banner, la card finale.
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "webrec", "check", "final")
os.makedirs(OUT, exist_ok=True)

# Scene (da make_show.SPEC + durations.txt): open 0-5.6 · click 5.6-15.1 ·
# pixels 15.1-24.4 · tailor 24.4-36.1 · globe 36.1-48.1 · swipe 48.1-56.4 ·
# home 56.4-68.7 · cta 68.2-75.5.
TIMES = [1.0, 4.0, 6.5, 8.3, 11.2, 13.0, 14.5, 16.5, 19.5, 22.5,
         25.5, 29.0, 33.5, 35.5, 37.5, 40.5, 42.5, 45.5, 47.7,
         49.5, 52.0, 55.5, 57.5, 61.0, 65.5, 69.5, 73.5]
JOBS = {
    "h": ("jht-play.mp4", TIMES),
    "v": ("jht-play-vertical.mp4", TIMES),
}

wanted = sys.argv[1:] or ["h", "v"]
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
