#!/usr/bin/env python3
"""Voce narrante del video di presentazione — generazione ISOLATA dal montaggio.

Il copione (7 battute, versione "sober" scelta dall'utente) è DATO, non
codice: LINES qui sotto. Il motore vocale è un'unica funzione dietro ENGINE:
oggi è `say` di macOS (Daniel en_GB, la migliore voce di sistema installata —
nessuna Premium presente, verificato con `say -v '?'`); quando arriverà il
motore a pagamento basterà aggiungere una funzione engine_<nome>() e cambiare
ENGINE, senza toccare il montaggio: make_show.py rilegge le durate REALI dei
wav da durations.txt, quindi un audio diverso riflow-a le pause da solo.

Output: audio/sober/segNN.wav (48 kHz mono) + durations.txt.
"""
import os, subprocess, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
AUD = os.path.join(ROOT, "audio")
VERSION = "sober"          # nome cartella: stabile, così il montaggio non cambia

# ── Copione (un elemento per scena del montaggio; "" = scena muta) ─────
# Scene: 01 hook · 02 reveal · 03 meeting · 04 roles · 05 dept ·
#        06 office · 07 chat · 08 globe · 09 webpages · 10 results ·
#        11 box · 12 cta
# Le scene mute parlano a schermo (didascalie/numeri): meeting, dept,
# webpages, results. Il testo è IDENTICO alla versione approvata dall'utente.
LINES = [
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
]


# ── Motori vocali ──────────────────────────────────────────────────────
# Contratto: engine_x(text, wav_out) scrive un wav 48 kHz mono, già senza
# silenzio in coda. Tutto il resto (nomi file, durate) è comune.
def engine_say(text: str, wav: str) -> None:
    """`say` di macOS — Daniel en_GB, rate 155 (tarato nelle tornate scorse)."""
    tmp = wav + ".raw.wav"
    # NB: contenitore .wav — con .aiff say rifiuta il little-endian (LEF32)
    # e fallisce con "Opening output file failed: fmt?".
    subprocess.run(
        ["say", "-o", tmp, "--data-format=LEF32@22050",
         "-v", "Daniel", "-r", "155", text],
        check=True,
    )
    # 48 kHz mono + trim del silenzio in coda (say ne lascia parecchio)
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", tmp,
         "-af", "silenceremove=stop_periods=1:stop_threshold=-45dB:stop_duration=0.35",
         "-ar", "48000", "-ac", "1", wav],
        check=True,
    )
    os.remove(tmp)


ENGINE = engine_say        # ← cambio motore = cambiare SOLO questa riga


def wav_duration(path: str) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", path], capture_output=True, text=True)
    return float(out.stdout.strip())


def synth() -> None:
    vdir = os.path.join(AUD, VERSION)
    os.makedirs(vdir, exist_ok=True)
    durs = []
    for i, line in enumerate(LINES):
        wav = os.path.join(vdir, f"seg{i:02d}.wav")
        if not line:
            durs.append(0.0)
            continue
        ENGINE(line, wav)
        durs.append(wav_duration(wav))
    with open(os.path.join(vdir, "durations.txt"), "w") as f:
        for i, d in enumerate(durs):
            f.write(f"{i:02d} {d:.2f}\n")
    print(f"[{VERSION}] motore={ENGINE.__name__}")
    for i, d in enumerate(durs):
        print(f"  seg{i:02d}: {d:5.2f}s  {LINES[i][:60]}")
    print(f"  totale parlato: {sum(durs):.1f}s")


if __name__ == "__main__":
    synth()
