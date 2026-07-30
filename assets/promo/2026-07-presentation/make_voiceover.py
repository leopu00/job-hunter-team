#!/usr/bin/env python3
"""Voce narrante del video di presentazione — 3 versioni con `say` di macOS.

Ogni versione ha UNA voce e un copione a segmenti: un segmento per scena del
montaggio (make_show.py). I file escono in audio/<versione>/segNN.wav e la
durata di ogni segmento viene stampata e scritta in audio/<versione>/durations.txt,
così il montaggio può verificare che il parlato stia nella finestra della scena.

Le voci sono quelle di sistema (niente Premium installate): il risultato è
riconoscibilmente sintetico ma pulito. La punteggiatura governa le pause.
"""
import os, subprocess, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
AUD = os.path.join(ROOT, "audio")

# ── Copioni ────────────────────────────────────────────────────────────
# Un elemento per scena: (testo, ). Testo vuoto = scena senza voce.
# Scene: 01 hook · 02 reveal · 03 meeting · 04 roles · 05 writers ·
#        06 office · 07 chat · 08 globe · 09 web-pages · 10 results ·
#        11 open-source · 12 CTA

VERSIONS = {
    # A — calda, americana, con bossa sotto: racconta.
    "warm": {
        "voice": "Samantha",
        "rate": 170,
        "lines": [
            "Job hunting? That's a second job.",
            "So we built you a team. Job Hunter Team.",
            "Real roles, a captain, and a weekly budget to respect.",
            "Scouts sweep the boards. Analysts read every posting. Scorers rate the fit, zero to a hundred.",
            "Writers tailor your CV for each position. Critics review every draft. No mercy.",
            "And here's the thing: it's not a dashboard. It's an office, inside a video game. You watch them work, while you do something else.",
            "You talk to them like teammates. Ask, steer, approve.",
            "Away from your desk? Open the web app. Every position they found, pinned on your own globe.",
            "Scores, salaries. Swipe to decide.",
            "One real month, hands off: six hundred fifty eight positions found.",
            "It's open source, and it runs on your machine. Your data stays yours.",
            "Job Hunter Team. Free, and in beta.",
        ],
    },
    # B — britannica, sobria, SENZA musica: asciutta e precisa.
    "sober": {
        "voice": "Daniel",
        "rate": 168,
        "lines": [
            "Job hunting is a second job.",
            "This is Job Hunter Team.",
            "A team of AI agents: clear roles, a captain, a weekly budget.",
            "Scouts sweep the job boards. Analysts read each posting. Scorers rate the fit from zero to one hundred.",
            "Writers tailor your CV, position by position. Critics review every draft.",
            "It is not a dashboard. It is an office, inside a video game. You watch your team work, while you do something else.",
            "You talk to them like teammates. Ask, steer, approve.",
            "And from anywhere, the web app: every position, pinned on your globe.",
            "Scores, salaries, quick reviews.",
            "In one real month it found six hundred fifty eight positions.",
            "Open source. It runs on your machine; your data stays yours.",
            "Job Hunter Team. Free, and in beta.",
        ],
    },
    # C — australiana, giocosa, elettro-bossa sotto: ritmo su.
    "upbeat": {
        "voice": "Karen",
        "rate": 178,
        "lines": [
            "Job hunting? Feels like a second job, right?",
            "Meet your new team. Job Hunter Team.",
            "Real roles, a captain, a weekly budget. A proper team.",
            "Scouts sweep the boards all night. Analysts read everything. Scorers rate the fit, zero to a hundred.",
            "Writers tailor your CV. Critics tear the drafts apart. No mercy.",
            "Best part? It's not a dashboard. It's an office, in a video game. Watch them work. Go live your life.",
            "Chat with them like teammates. Ask, steer, approve.",
            "On the go? Open the web app. Every position, pinned on your globe.",
            "Scores, salaries. Swipe, done.",
            "One month, hands off: six hundred fifty eight positions.",
            "Open source, runs on your machine. Your data stays yours.",
            "Job Hunter Team. Free, in beta. Come say hi.",
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
