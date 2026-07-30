#!/usr/bin/env python3
"""Estrae fotogrammi di controllo dal video per la verifica visiva."""
import os, subprocess
ROOT = os.path.dirname(os.path.abspath(__file__))
MP4 = os.path.join(ROOT, "jht-presentation.mp4")
OUT = os.path.join(ROOT, "scenes", "check")
os.makedirs(OUT, exist_ok=True)
for t in [18, 25.5, 28, 30.5]:
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", str(t), "-i", MP4,
                    "-frames:v", "1", os.path.join(OUT, f"g_{t}.png")], check=True)
print("ok")
