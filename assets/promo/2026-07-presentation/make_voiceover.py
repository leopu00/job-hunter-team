#!/usr/bin/env python3
"""Voce narrante del video di presentazione — generazione ISOLATA dal montaggio.

Copione «Now Playable» (regia 03/08, §6): otto battute V1..V8, PAROLA PER
PAROLA dalla regia approvata — niente riscritture in produzione (§7.4: le
formule sulla copertura web sono quelle verificate, non si «migliorano»).
Tono: brillante, complice, da trailer di gioco raccontato da un amico.
Il montaggio dimensiona le scene sulle durate REALI dei wav (durations.txt).

Motore: ElevenLabs, voce George (Warm, Captivating Storyteller, en-GB).
George era stato scelto per il taglio narrativo precedente; per il registro
nuovo è stato RIMESSO in discussione con un'audizione misurata sulla V1
contro tre voci più «da trailer» (Liam, Charlie, Will):
  | voce    | c/s  | f0 med | centroide | sd RMS |
  | George  | 15,7 |  137   |  2320 Hz  | 0,099  |  ← tenuto
  | Liam    | 14,9 |  131   |  1883 Hz  | 0,093  |
  | Charlie | 17,3 |  120   |   971 Hz  | 0,106  |
  | Will    | 17,1 |  117   |  2333 Hz  | 0,074  |
George sulla battuta-esca è il più brillante dei quattro dove conta: dizione
nitida quanto Will (centroide alla pari) ma con la consegna più viva
(sd RMS massima a parità di nitidezza) e la f0 più alta — regge il sorriso
del registro nuovo senza perdere l'autorevolezza che disinnesca il
«sembra un giochino». Charlie è energico ma impastato (971 Hz), Will chiaro
ma piatto, Liam più lento. I wav dell'audizione sono in audio/candidates/.

La chiave API sta in ~/.config/jht/elevenlabs.env e NON va mai stampata.

Output: audio/play/segNN.wav (48 kHz mono) + durations.txt.
"""
import json, os, subprocess, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
AUD = os.path.join(ROOT, "audio")
VERSION = "play"           # regia «Now Playable»; la cartella sober/ resta

# ── Copione (un elemento per scena del montaggio: V1..V8, regia §6) ────
# Scene: 01 open · 02 click · 03 pixels · 04 tailor · 05 globe ·
#        06 swipe · 07 home · 08 cta
LINES = [
    "This looks like a video game. It is. It's also your job search.",
    "This is Job Hunter Team — an office full of AI agents hunting jobs for you. And you're the boss: click anyone, ask anything, give orders.",
    "Don't let the pixels fool you. These characters run on frontier AI — the models behind today's top assistants — working one case: yours.",
    "They learn your profile and score every role against it — this one's an eighty-eight. Your CV gets rewritten for that exact posting… and reviewed, hard, until it passes.",
    "And they don't browse one site's catalog. The big boards. The niche ones. Company career pages. The open web. Wherever jobs are posted — that's where they hunt.",
    "Then the best part: you call it. Swipe — yes… no… next. The last word is always yours.",
    "All of it runs on your own computer — your data never leaves home. And the office never closes: at work, on holiday, asleep — your team keeps hunting.",
    "Job Hunter Team. Free. Open source. Your job hunt — now playable.",
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
