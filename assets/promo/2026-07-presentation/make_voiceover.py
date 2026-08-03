#!/usr/bin/env python3
"""Voce narrante del video di presentazione — generazione ISOLATA dal montaggio.

Copione RICCO (tornata 03/08-bis): l'utente preferiva la versione a 12 battute
alla dimagrita a 7 — qui 11 battute che recuperano i contenuti tagliati (i
cinque ruoli e cosa fanno, la chat con gli agenti, i numeri reali del mese),
senza affastellare: una battuta per scena, l'unica scena muta è webpages
(parla a didascalie). Il montaggio dimensiona le scene sulle durate REALI dei
wav (durations.txt), quindi il testo può respirare senza mai essere compresso.

Motore: ElevenLabs (George — Warm, Captivating Storyteller, en-GB), scelto
confrontando 4 candidate maschili sulla stessa frase (George/Roger/Brian/
Bill): Brian correva monotono (21 caratteri/s, IQR f0 17 Hz), Bill teatrale
e lento (14,5 c/s, IQR 74), Roger e George alla pari sul passo (~17,5 c/s)
ma George ha dizione più nitida (centroide 3,7 kHz) su un baritono caldo
(f0 mediana 124 Hz) — ed è la voce disegnata per narrazione. Il vecchio
motore `say` (Daniel) resta come fallback offline: basta cambiare ENGINE.

La chiave API sta in ~/.config/jht/elevenlabs.env e NON va mai stampata.

Output: audio/sober/segNN.wav (48 kHz mono) + durations.txt.
"""
import json, os, subprocess, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
AUD = os.path.join(ROOT, "audio")
VERSION = "sober"          # nome cartella: stabile, così il montaggio non cambia

# ── Copione (un elemento per scena del montaggio; "" = scena muta) ─────
# Scene: 01 hook · 02 reveal · 03 meeting · 04 roles · 05 dept ·
#        06 office · 07 chat · 08 globe · 09 webpages · 10 results ·
#        11 box · 12 cta
# 11 battute (~750 caratteri): recuperate dal copione ricco le ex 3/4/5/7/10
# che l'utente rimpiangeva (ruoli, Writers/Critics, chat, numeri del mese).
LINES = [
    "Job hunting is a second job.",
    "So we built you a team. Job Hunter Team.",
    "A team of AI agents, with clear roles, a captain, and a weekly budget.",
    "Scouts sweep the job boards. Analysts read every posting. And Scorers rate each match against your profile, from zero to one hundred.",
    "Writers tailor your CV, position by position. Critics review every draft.",
    "It is not a dashboard. It is an office, inside a video game. You watch your team work, while you do something else.",
    "And you talk to them like teammates. Ask, steer, approve.",
    "From anywhere: every position they found, on your own globe.",
    "",
    "In one real month, hands off, they found six hundred and fifty-eight positions.",
    "Open source. It runs on your machine, and your data stays yours.",
    "Job Hunter Team. Free, and in beta.",
]


# ── Motori vocali ──────────────────────────────────────────────────────
# Contratto: engine_x(text, wav_out, prev, nxt) scrive un wav 48 kHz mono,
# già senza silenzio in coda. prev/nxt = battute adiacenti (contesto di
# prosodia per i motori che lo supportano). Tutto il resto è comune.
def engine_say(text, wav, prev="", nxt=""):
    """`say` di macOS — Daniel en_GB, rate 155. Fallback offline."""
    tmp = wav + ".raw.wav"
    # NB: contenitore .wav — con .aiff say rifiuta il little-endian (LEF32)
    # e fallisce con "Opening output file failed: fmt?".
    subprocess.run(
        ["say", "-o", tmp, "--data-format=LEF32@22050",
         "-v", "Daniel", "-r", "155", text],
        check=True,
    )
    _finish(tmp, wav)


EL_VOICE = "JBFqnCBsd6RMkjVDRZzb"      # George — Warm, Captivating Storyteller
EL_MODEL = "eleven_multilingual_v2"    # qualità > velocità per una narrazione

def engine_elevenlabs(text, wav, prev="", nxt=""):
    """ElevenLabs TTS. La chiave viene letta dal file env DENTRO il comando
    e non transita mai da stdout/argomenti loggati in chiaro nei file."""
    key = None
    with open(os.path.expanduser("~/.config/jht/elevenlabs.env")) as f:
        for line in f:
            if line.startswith("ELEVENLABS_API_KEY="):
                key = line.strip().split("=", 1)[1]
    if not key:
        sys.exit("ELEVENLABS_API_KEY mancante in ~/.config/jht/elevenlabs.env")
    body = {
        "text": text,
        "model_id": EL_MODEL,
        # stability media = espressivo ma composto (tarato sull'audizione)
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
    }
    # contesto delle battute adiacenti: prosodia continua fra i segmenti
    if prev:
        body["previous_text"] = prev
    if nxt:
        body["next_text"] = nxt
    tmp = wav + ".raw.mp3"
    r = subprocess.run(
        ["curl", "-s", "-w", "%{http_code}", "-o", tmp, "-X", "POST",
         f"https://api.elevenlabs.io/v1/text-to-speech/{EL_VOICE}"
         "?output_format=mp3_44100_128",
         "-H", f"xi-api-key: {key}", "-H", "Content-Type: application/json",
         "-d", json.dumps(body)],
        capture_output=True, text=True, check=True)
    if r.stdout.strip() != "200":
        sys.exit(f"ElevenLabs HTTP {r.stdout.strip()} su '{text[:40]}…'")
    _finish(tmp, wav)


def _finish(tmp, wav):
    """Comune ai motori: 48 kHz mono + trim del silenzio SOLO a testa e coda.
    NB: il vecchio silenceremove stop_periods=1 tagliava alla prima pausa
    INTERNA (George respira fra le frasi → battute mozzate a metà): il giro
    areverse tocca soltanto le estremità e lascia intatte le pause."""
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", tmp,
         "-af", ("silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.1,"
                 "areverse,"
                 "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,"
                 "areverse"),
         "-ar", "48000", "-ac", "1", wav],
        check=True,
    )
    os.remove(tmp)


ENGINE = engine_elevenlabs   # ← cambio motore = cambiare SOLO questa riga


def wav_duration(path: str) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", path], capture_output=True, text=True)
    return float(out.stdout.strip())


def synth() -> None:
    vdir = os.path.join(AUD, VERSION)
    os.makedirs(vdir, exist_ok=True)
    spoken = [l for l in LINES if l]
    durs = []
    for i, line in enumerate(LINES):
        wav = os.path.join(vdir, f"seg{i:02d}.wav")
        if not line:
            durs.append(0.0)
            continue
        k = spoken.index(line)
        prev = spoken[k - 1] if k > 0 else ""
        nxt = spoken[k + 1] if k < len(spoken) - 1 else ""
        ENGINE(line, wav, prev, nxt)
        durs.append(wav_duration(wav))
    with open(os.path.join(vdir, "durations.txt"), "w") as f:
        for i, d in enumerate(durs):
            f.write(f"{i:02d} {d:.2f}\n")
    print(f"[{VERSION}] motore={ENGINE.__name__}")
    for i, d in enumerate(durs):
        print(f"  seg{i:02d}: {d:5.2f}s  {LINES[i][:60]}")
    print(f"  totale parlato: {sum(durs):.1f}s  ·  {sum(len(l) for l in LINES)} caratteri")


if __name__ == "__main__":
    synth()
