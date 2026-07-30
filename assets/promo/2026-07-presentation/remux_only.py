#!/usr/bin/env python3
"""Rimuxa le tracce audio sul video già montato (build/video.mp4) senza
rifare il montaggio. Utile per iterare su voce/musica/livelli."""
import os, sys
from make_show import VERSIONS, mux, ROOT, BUILD

video = os.path.join(BUILD, "video.mp4")
if not os.path.isfile(video):
    sys.exit("manca build/video.mp4 — lancia make_show.py")
wanted = sys.argv[1:] or list(VERSIONS)
for v in wanted:
    mux(video, v, os.path.join(ROOT, f"jht-show-{v}.mp4"))
