#!/usr/bin/env python3
"""Voce narrante del video di presentazione — versione FINALE, `say` di macOS.

Una sola versione ("sober", Daniel en_GB, niente musica): è quella scelta
dall'utente fra le tre della tornata precedente. Il copione è stato TAGLIATO
da 12 a 7 battute — la voce dice solo l'essenziale, il resto passa a schermo
(didascalie, numeri, etichette — vedi make_show.py). Rate abbassato da 168 a
155 e cinque scene lasciate MUTE: il silenzio fra le frasi è voluto.

Un segmento per scena del montaggio (testo vuoto = scena senza voce). I file
escono in audio/<versione>/segNN.wav; le durate finiscono in durations.txt,
così il montaggio verifica che ogni frase stia nella finestra della sua scena.

La voce è quella di sistema (niente Premium installate): riconoscibilmente
sintetica ma pulita. La punteggiatura governa le pause interne.
"""
import os, subprocess, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
AUD = os.path.join(ROOT, "audio")

# ── Copione ────────────────────────────────────────────────────────────
# Scene: 01 hook · 02 reveal · 03 meeting · 04 roles · 05 writers ·
#        06 office · 07 chat · 08 globe · 09 web-pages · 10 results ·
#        11 open-source · 12 CTA
# Battute tolte rispetto alla tornata precedente (ora dette dallo SCHERMO):
#   meeting  → didascalia "clear roles · a captain · a weekly budget"
#   roles    → mansioni sotto i ritratti ("sweep the job boards", …)
#   dept     → didascalia Writers/Critics
#   chat     → didascalia "ask · steer · approve"
#   webpages → didascalie "match scores · salaries" / "swipe to decide"
#   results  → i numeri grandi del mese reale (658 · 520 · 307 · 71)

VERSIONS = {
    # Daniel en_GB, sobria, SENZA musica — la versione scelta.
    "sober": {
        "voice": "Daniel",
        "rate": 155,
        "lines": [
            "Job hunting is a second job.",
            "So we built you a team. Job Hunter Team.",
            "",
            "Your agents find the positions, and score every match against your profile.",
            "",
            "It is not a dashboard. It is an office, inside a video game. You watch your team work, while you do something else.",
            "",
            "And from anywhere: every position they found, on your own globe.",
            "",
            "",
            "Open source. It runs on your machine, and your data stays yours.",
            "Job Hunter Team. Free, and in beta.",
        ],
    },
}


def synth(version: str) -> None:
    cfg = VERSIONS[version]
    vdir = os.path.join(AUD, version)
    os.makedirs(vdir, exist_ok=True)
    durs = []
    for i, line in enumerate(cfg["lines"]):
        aiff = os.path.join(vdir, f"seg{i:02d}.raw.wav")
        wav = os.path.join(vdir, f"seg{i:02d}.wav")
        if not line:
            durs.append(0.0)
            continue
        # NB: contenitore .wav — con .aiff say rifiuta il little-endian
        # (LEF32) e fallisce con "Opening output file failed: fmt?".
        subprocess.run(
            ["say", "-o", aiff, "--data-format=LEF32@22050",
             "-v", cfg["voice"], "-r", str(cfg["rate"]), line],
            check=True,
        )
        # 48 kHz mono + trim del silenzio in coda (say ne lascia parecchio)
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", aiff,
             "-af", "silenceremove=stop_periods=1:stop_threshold=-45dB:stop_duration=0.35",
             "-ar", "48000", "-ac", "1", wav],
            check=True,
        )
        os.remove(aiff)
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", wav], capture_output=True, text=True)
        durs.append(float(out.stdout.strip()))
    with open(os.path.join(vdir, "durations.txt"), "w") as f:
        for i, d in enumerate(durs):
            f.write(f"{i:02d} {d:.2f}\n")
    print(f"[{version}] ({cfg['voice']})")
    for i, d in enumerate(durs):
        print(f"  seg{i:02d}: {d:5.2f}s  {cfg['lines'][i][:60]}")
    print(f"  totale parlato: {sum(durs):.1f}s")


if __name__ == "__main__":
    wanted = sys.argv[1:] or list(VERSIONS)
    for v in wanted:
        synth(v)
