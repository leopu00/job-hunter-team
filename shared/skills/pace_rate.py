#!/usr/bin/env python3
"""pace_rate.py — il RITMO di un contatore intero, in un solo posto.

Il contatore del provider (`usage`, `weekly_usage`) e' un intero che sale a scalini quando il provider lo aggiorna, non
quando il team spende. Ogni formula locale che ne faceva un ritmo (delta / pochi minuti, punti nelle ultime 2,5 h per
le ore al reset, finestra "adattiva" di 3 punti) dava numeri che non dicevano niente del team, e i freni scattavano
sul rumore. Misurato su un team reale (29/10-01/11):

  * un passo di 1 punto in un campione da 5 minuti = 12,0 %/h (21 campioni su 288 il 29/10);
  * 2 punti nelle ultime 2,5 h proiettati sulle 76 h al reset = +61 punti di proiezione (ATTENZIONE, throttle 60 s)
    mentre il ritmo settimanale era 0,44 del sostenibile;
  * +3 punti in 5 minuti con 0,05 punti di token del team (01/11 21:05Z) = «12,00 %/h» su una finestra da 15 minuti,
    poi «4,00 %/h» su 60: due URG della Sentinella «stop new spawns» con la pipeline vuota;
  * il contatore che scende da 29 a 20 senza reset (lettura vecchia sostituita da una fresca) = velocity -108 %/h,
    proiezione -455 e weekly_pace cieco per 2 h 55.

Regole, valide per qualunque contatore intero e per qualunque asse:

  1. Un ritmo si misura su almeno MIN_SPAN_H ore (60 minuti): il ritmo di una finestra piu' corta non e' un ritmo.
  2. Il contatore e' arrotondato: fra due letture il consumo vero sta in (delta-1, delta+1). Il ritmo e' quindi un
     INTERVALLO [lo, hi] = [max(0, delta-1), delta+1] / ore. «Sopra il ritmo» (freno) solo se il limite BASSO supera la
     soglia, «sotto il ritmo» (accelera) solo se il limite ALTO sta sotto: un'incertezza non da' un verdetto.
  3. Un salto di JUMP_PTS punti o piu' fra due campioni a meno di JUMP_MAX_DT_S non e' un ritmo del team (36 %/h:
     nessun team lo spende in 5 minuti): e' un consumo non attribuibile (altro uso dello stesso account, ricalcolo del
     provider). Non entra nel ritmo; resta nel livello speso, che e' quello vero.
  4. Un calo senza reset e' un nuovo punto di partenza (una lettura vecchia sostituita da una fresca): si riparte da li',
     mai ritmi o proiezioni negativi.
  5. La finestra e' la piu' corta, fra MIN_SPAN_H e MAX_SPAN_H, che contiene MIN_DELTA punti; altrimenti la piu' lunga.
  6. Una lettura isolata che crolla e alla lettura dopo torna al livello di prima (77, 0, 77) non e' un reset: e' una
     lettura sbagliata del provider. Non entra in nessuna serie (drop_isolated_readings); un reset vero non torna su.
  7. I kT per punto (kt_per_point) si misurano sui punti GUADAGNATI in ore, salti compresi, non in una finestra da un'ora
     da cui i salti sono tolti: con un contatore intero e aggiornato a scatti il rapporto di una finestra non e' il
     rapporto del team (tick di un team reale, 28/10-03/11: 930 kT per punto contro i ~400 della settimana intera).

Funzione pura: nessun I/O. Usata da weekly_pace.py, compute_metrics.py e dal pacing-bridge.
"""
from __future__ import annotations

MIN_SPAN_H = 1.0          # ritmo misurato su almeno un'ora
MAX_SPAN_H = 8.0          # e al piu' otto (oltre, la lettura e' troppo vecchia)
MIN_DELTA = 3             # punti che rendono affidabile una finestra corta (errore di arrotondamento < 33 %)
JUMP_PTS = 3              # salto non attribuibile al team...
JUMP_MAX_DT_S = 600       # ...se avviene fra due campioni a meno di 10 minuti
GLITCH_DROP_PTS = 3       # una lettura che scende di tanto, e poi torna al livello di prima...
GLITCH_MAX_RUN = 3        # ...dopo al massimo tre letture...
GLITCH_MAX_S = 1200       # ...e al massimo venti minuti, e' una lettura sbagliata, non un reset
RATIO_MIN_GAIN = 8.0      # punti guadagnati che rendono affidabile un rapporto kT/punto (errore di arrotondamento < 13 %)
RATIO_MIN_SPAN_H = 6.0
RATIO_MAX_SPAN_H = 48.0


def drop_isolated_readings(samples):
    """Le letture che crollano e subito tornano al livello di prima sono tolte: (serie, [(epoch, valore), ...] tolte).

    Un reset vero resta basso; una lettura sbagliata del provider (77, 0, 77) torna su. Tolta, la serie non ha ne' il
    calo che riparte da zero ne' il salto "non attribuibile" di ritorno che accorciano la finestra del ritmo.
    """
    samples = list(samples)
    out, dropped = [], []
    i = 0
    while i < len(samples):
        t, v = samples[i]
        if out and out[-1][1] - v >= GLITCH_DROP_PTS:
            base = out[-1][1]
            end = None
            for j in range(i + 1, min(len(samples), i + 1 + GLITCH_MAX_RUN)):
                if samples[j][1] >= base - 1:
                    end = j
                    break
                if base - samples[j][1] < GLITCH_DROP_PTS:
                    break
            if end is not None and samples[end][0] - out[-1][0] <= GLITCH_MAX_S:
                dropped.extend(samples[i:end])
                i = end
                continue
        out.append((t, v))
        i += 1
    return out, dropped


def adjust_series(samples):
    """(serie corretta, info): salti non attribuibili tolti dal livello, cali = nuovo punto di partenza.

    `samples` = [(epoch, valore)] ordinati per tempo. La serie corretta ha lo stesso numero di punti dall'ultimo calo.
    """
    samples, glitches = drop_isolated_readings(samples)
    out = []
    offset = 0.0
    jumps = []
    rebaselined = None
    prev = None
    for t, v in samples:
        if prev is not None:
            delta = v - prev[1]
            if delta < 0:
                out, offset, jumps = [], 0.0, []
                rebaselined = t
            elif delta >= JUMP_PTS and (t - prev[0]) <= JUMP_MAX_DT_S:
                offset += delta
                jumps.append((t, delta))
        out.append((t, v - offset))
        prev = (t, v)
    return out, {"rebaselined_at": rebaselined, "unattributed_pts": sum(d for _, d in jumps), "jumps": jumps,
                 "discarded_readings": glitches}


def counter_rate(samples, now_ts, *, min_span_h=MIN_SPAN_H, max_span_h=MAX_SPAN_H, min_delta=MIN_DELTA):
    """Il ritmo del contatore in %/h con il suo intervallo, o None se i dati non bastano.

    Ritorna {rate, lo, hi, delta, span_h, n, rebaselined, unattributed_pts, samples} (rate/lo/hi in %/h).
    `samples` = [(epoch, valore)], anche disordinati e fuori finestra.
    """
    since = now_ts - max_span_h * 3600.0
    window = sorted((float(t), float(v)) for t, v in samples if since <= t <= now_ts)
    if len(window) < 2:
        return None
    series, info = adjust_series(window)
    if len(series) < 2:
        return None
    newest = series[-1]
    chosen = None
    for s in reversed(series[:-1]):
        span = newest[0] - s[0]
        if span >= min_span_h * 3600.0 and newest[1] - s[1] >= min_delta:
            chosen = s
            break
    if chosen is None:
        oldest = series[0]
        if newest[0] - oldest[0] < min_span_h * 3600.0:
            return None
        chosen = oldest
    span_h = (newest[0] - chosen[0]) / 3600.0
    delta = max(0.0, newest[1] - chosen[1])
    return {
        "rate": delta / span_h,
        "lo": max(0.0, delta - 1.0) / span_h,
        "hi": (delta + 1.0) / span_h,
        "delta": delta,
        "span_h": span_h,
        "n": len(series),
        "rebaselined": info["rebaselined_at"] is not None,
        "unattributed_pts": info["unattributed_pts"],
        "samples": series,
    }


def kt_per_point(samples, events, now_ts, *, min_gain=RATIO_MIN_GAIN, min_span_h=RATIO_MIN_SPAN_H,
                 max_span_h=RATIO_MAX_SPAN_H):
    """kT del team per punto di budget, sui punti GUADAGNATI in ore, o None se i dati non bastano.

    `samples` = [(epoch, valore)] del contatore, `events` = [(epoch, kT)] del consumo del team. Guadagno = somma dei passi
    in su, senza le letture isolate; i cali (reset) contano zero e il guadagno ricomincia da li'. I salti di JUMP_PTS punti
    o piu' CONTANO (come nel totale della settimana, dove 29.886 kT su 75 punti dicono ~400): un contatore che il provider
    aggiorna a scatti, ogni tanto, fa passi da 3 punti che sono consumo del team; toglierli (come fa adjust_series per il
    ritmo) lascia i kT interi su meno punti e gonfia il rapporto. L'inizio e' il punto piu' vicino a ora che sta a almeno `min_span_h` ore e porta almeno `min_gain` punti; mai
    oltre `max_span_h`. Ritorna {ratio, kt, gain, span_h} o None: chi legge ripiega su altro, non su un numero finto.
    """
    since = now_ts - max_span_h * 3600.0
    window = sorted((float(t), float(v)) for t, v in samples if since <= t <= now_ts)
    window, _ = drop_isolated_readings(window)
    if len(window) < 2:
        return None
    gains = [0.0]
    for (t0, v0), (t1, v1) in zip(window, window[1:]):
        gains.append(gains[-1] + max(0.0, v1 - v0))     # i salti contano: vedi sopra
    end_t = window[-1][0]
    start = None
    for k in range(len(window) - 2, -1, -1):
        if end_t - window[k][0] >= min_span_h * 3600.0 and gains[-1] - gains[k] >= min_gain:
            start = k
            break
    if start is None:
        return None
    gain = gains[-1] - gains[start]
    start_t = window[start][0]
    kt = sum(float(w) for t, w in events if start_t <= t <= end_t)
    if gain <= 0 or kt <= 0:
        return None
    return {"ratio": kt / gain, "kt": kt, "gain": gain, "span_h": (end_t - start_t) / 3600.0}


def classify(result, sustainable, *, above=1.2, below=0.8):
    """SOPRA-PACE | SOTTO-PACE | ALLINEATO | ND, con la regola dell'intervallo (vedi la docstring del modulo)."""
    if result is None or not isinstance(sustainable, (int, float)) or sustainable <= 0:
        return "ND"
    if result["lo"] / sustainable > above:
        return "SOPRA-PACE"
    if result["hi"] / sustainable < below:
        return "SOTTO-PACE"
    return "ALLINEATO"
