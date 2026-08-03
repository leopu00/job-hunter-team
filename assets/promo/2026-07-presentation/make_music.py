#!/usr/bin/env python3
"""Basi musicali PROCEDURALI per il video di presentazione (numpy → wav).

Niente campioni, niente download: tutto sintetizzato — sul Mac non c'è
musica royalty-free e nessuna traccia di terzi può finire nel video.

Due tappeti da ~66 s, pensati per stare SOTTO una voce narrante:

  bossa    ~112 BPM — giro lounge I–vi–ii–V (Cmaj9 Am9 Dm9 G13), basso
           bossa (tonica-quinta puntata), comping "Rhodes" sincopato,
           shaker in ottavi e rim-click. Musichetta da ascensore, voluta.
  electro  ~120 BPM — stesso giro con cassa quattro-quarti morbida,
           pluck arpeggiato in sedicesimi e hat in levare. Brazilian
           electro da salotto, sempre tappeto.

Output: audio/music_bossa.wav, audio/music_electro.wav (48 kHz stereo).
"""
import os
import numpy as np

SR = 48000
ROOT = os.path.dirname(os.path.abspath(__file__))
AUD = os.path.join(ROOT, "audio")
os.makedirs(AUD, exist_ok=True)

rng = np.random.default_rng(20260730)


def note_hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def env_ad(n, a, d, curve=4.0):
    """Attacco lineare a campioni `a`, decadimento esponenziale su `d`."""
    e = np.ones(n)
    a = max(1, min(a, n))
    e[:a] = np.linspace(0, 1, a)
    t = np.arange(n - a) / max(1, d)
    e[a:] = np.exp(-curve * t)
    return e


def onepole_lp(x, cutoff):
    """Passa-basso a un polo (caldo, economico)."""
    dt = 1.0 / SR
    rc = 1.0 / (2 * np.pi * cutoff)
    alpha = dt / (rc + dt)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += alpha * (x[i] - acc)
        y[i] = acc
    return y


def rhodes(midi, dur, vel=1.0, detune=0.0025):
    """Tine elettrico: fondamentale + armoniche deboli, doppio osc detunato."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = note_hz(midi)
    x = np.zeros(n)
    for mult, amp in ((1, 1.0), (2, 0.28), (3, 0.10), (4, 0.045)):
        x += amp * np.sin(2 * np.pi * f * mult * t)
        x += amp * 0.8 * np.sin(2 * np.pi * f * mult * (1 + detune) * t + 0.7)
    x *= env_ad(n, int(0.006 * SR), int(0.9 * SR), curve=3.2)
    return vel * 0.16 * x


def bass(midi, dur, vel=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = note_hz(midi)
    x = np.sin(2 * np.pi * f * t) + 0.22 * np.sin(2 * np.pi * 2 * f * t + 0.4)
    x *= env_ad(n, int(0.004 * SR), int(0.55 * SR), curve=3.0)
    return vel * 0.34 * x


def pluck(midi, dur, vel=1.0):
    """Pluck brillante per l'arpeggio electro (armoniche dispari smorzate)."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = note_hz(midi)
    x = np.zeros(n)
    for mult, amp in ((1, 1.0), (3, 0.25), (5, 0.11), (7, 0.05)):
        x += amp * np.sin(2 * np.pi * f * mult * t)
    x *= env_ad(n, int(0.002 * SR), int(0.16 * SR), curve=5.0)
    return vel * 0.10 * x


def _noise_burst(dur, lo, hi, vel, curve=6.0):
    n = int(dur * SR)
    x = rng.standard_normal(n)
    X = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(n, 1 / SR)
    X[(freqs < lo) | (freqs > hi)] = 0
    x = np.fft.irfft(X, n)
    x /= max(1e-9, np.max(np.abs(x)))
    return vel * x * env_ad(n, int(0.001 * SR), int(dur * 0.5 * SR), curve=curve)


def shaker(vel=1.0):
    return _noise_burst(0.07, 5000, 11000, 0.05 * vel)


def rim(vel=1.0):
    n = int(0.045 * SR)
    t = np.arange(n) / SR
    body = 0.6 * np.sin(2 * np.pi * 810 * t) * env_ad(n, 8, int(0.012 * SR), 5)
    snap = _noise_burst(0.045, 1500, 4000, 0.5 * vel)
    return 0.16 * (body + snap)


def kick(vel=1.0):
    n = int(0.14 * SR)
    t = np.arange(n) / SR
    f = 85 * np.exp(-t * 18) + 42
    phase = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(phase) * env_ad(n, 12, int(0.09 * SR), 3.5)
    return 0.5 * vel * x


# ── partitura ──────────────────────────────────────────────────────────
# Giro I–vi–ii–V in Do: voicing stretti attorno al Do centrale.
CHORDS = [
    ("C", [60, 64, 67, 71, 74], 36),   # Cmaj9  (basso C2)
    ("Am", [57, 60, 64, 67, 71], 33),  # Am9    (basso A1)
    ("Dm", [62, 65, 69, 72, 76], 38),  # Dm9    (basso D2)
    ("G", [59, 62, 65, 67, 76], 31),   # G13    (basso G1)
]


def place(buf, start_s, x, pan_l=1.0, pan_r=1.0):
    i0 = int(start_s * SR)
    i1 = min(buf.shape[1], i0 + len(x))
    if i1 <= i0:
        return
    seg = x[: i1 - i0]
    buf[0, i0:i1] += pan_l * seg
    buf[1, i0:i1] += pan_r * seg


def render(kind, total_s, out_name):
    buf = np.zeros((2, int(total_s * SR)))
    bpm = 112 if kind == "bossa" else 120
    spb = 60.0 / bpm                      # secondi per beat
    bar = 4 * spb
    nbars = int(total_s / bar) + 1

    for b in range(nbars):
        t0 = b * bar
        _, voicing, bnote = CHORDS[b % 4]

        # basso bossa: tonica (1ᵃ e 3ᵃ) e quinta in levare
        fifth = bnote + 7
        place(buf, t0 + 0.0 * spb, bass(bnote, 1.4 * spb), 1.0, 0.9)
        place(buf, t0 + 1.5 * spb, bass(fifth, 0.45 * spb, 0.8), 1.0, 0.9)
        place(buf, t0 + 2.0 * spb, bass(bnote, 1.4 * spb, 0.95), 1.0, 0.9)
        place(buf, t0 + 3.5 * spb, bass(fifth, 0.45 * spb, 0.75), 1.0, 0.9)

        # comping: due posizioni alternate per non essere un metronomo
        hits = ((0.5, 0.9, 0.9), (2.0, 1.6, 1.0), (3.25, 0.6, 0.8)) \
            if b % 2 == 0 else ((1.0, 0.9, 0.85), (2.5, 1.4, 1.0))
        for beat, hold, vel in hits:
            for k, m in enumerate(voicing):
                pan = 0.75 + 0.5 * (k / (len(voicing) - 1))   # apre lo stereo
                place(buf, t0 + beat * spb + k * 0.011,
                      rhodes(m, hold * spb, vel), 2 - pan, pan)

        # shaker in ottavi, accenti in levare
        for e in range(8):
            vel = 1.0 if e % 2 else 0.55
            place(buf, t0 + e * 0.5 * spb, shaker(vel), 0.8, 1.2)

        # rim-click stile clave, scarno
        for beat in ((0.0, 2.5) if b % 2 == 0 else (1.5, 3.0)):
            place(buf, t0 + beat * spb, rim(0.8), 1.1, 0.9)

        if kind == "electro":
            for beat in range(4):
                place(buf, t0 + beat * spb, kick(0.9))
            # hat in levare più presente
            for beat in range(4):
                place(buf, t0 + (beat + 0.5) * spb, shaker(1.4), 0.9, 1.1)
            # arpeggio pluck in sedicesimi (sale sul voicing)
            seq = voicing + voicing[-2:0:-1]
            for s16 in range(16):
                if s16 % 2 == 1 and rng.random() < 0.35:
                    continue                       # respiro, non un trapano
                m = seq[s16 % len(seq)] + 12
                pan = 0.7 + 0.6 * ((s16 % 4) / 3)
                place(buf, t0 + s16 * 0.25 * spb,
                      pluck(m, 0.22 * spb, 0.8), 2 - pan, pan)

    # master: caldo (passa-basso) + soft-clip leggero + normalizza
    for ch in range(2):
        buf[ch] = onepole_lp(buf[ch], 8500 if kind == "bossa" else 10500)
    buf = np.tanh(buf * 1.3)
    buf *= 0.88 / max(1e-9, np.max(np.abs(buf)))

    # coda in dissolvenza (2.5 s) e attacco morbido (0.5 s)
    n = buf.shape[1]
    fade_in = int(0.5 * SR)
    fade_out = int(2.5 * SR)
    buf[:, :fade_in] *= np.linspace(0, 1, fade_in)
    buf[:, -fade_out:] *= np.linspace(1, 0, fade_out)

    out = os.path.join(AUD, out_name)
    pcm = (buf.T * 32767).astype(np.int16)
    import wave
    with wave.open(out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"{out_name}: {total_s:.0f}s, picco {np.max(np.abs(buf)):.2f}")


if __name__ == "__main__":
    render("bossa", 66, "music_bossa.wav")
    render("electro", 66, "music_electro.wav")
