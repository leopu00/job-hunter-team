#!/usr/bin/env python3
"""Estrae fotogrammi di controllo dai DUE video (orizzontale e verticale)
per la verifica visiva.

Tempi tarati sulla scaletta corrente (13 scene, ~59 s): coprono ogni scena,
con più campioni sulle tre riprese vere del gioco (dept 19-25, office 26-35,
chat 35-44). Stessa scaletta e stessi tempi nei due formati, quindi stessi
campioni: sui frame verticali va controllato in più che il ritaglio 9:16
non tagli mai il soggetto (agenti e vignette).
"""
import os, subprocess
ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "scenes", "check")
os.makedirs(OUT, exist_ok=True)
VIDEOS = [("g", os.path.join(ROOT, "jht-presentation.mp4")),
          ("v", os.path.join(ROOT, "jht-presentation-vertical.mp4"))]
for prefix, mp4 in VIDEOS:
    if not os.path.isfile(mp4):
        print(f"salto {mp4}: non esiste")
        continue
    for t in [2, 6, 9.5, 13, 15.2, 17.5,
              20, 22, 24.5,          # dept (ripresa vera)
              27, 30, 33.5,          # office (ripresa vera)
              36.5, 39.5, 42.5,      # chat (ripresa vera)
              45.5, 49, 53, 56.5]:
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", str(t), "-i", mp4,
                        "-frames:v", "1", os.path.join(OUT, f"{prefix}_{t}.png")],
                       check=True)
print("ok")
