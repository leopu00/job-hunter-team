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

Funzione pura: nessun I/O. Usata da weekly_pace.py, compute_metrics.py e dal pacing-bridge.
"""
from __future__ import annotations

MIN_SPAN_H = 1.0          # ritmo misurato su almeno un'ora
MAX_SPAN_H = 8.0          # e al piu' otto (oltre, la lettura e' troppo vecchia)
MIN_DELTA = 3             # punti che rendono affidabile una finestra corta (errore di arrotondamento < 33 %)
JUMP_PTS = 3              # salto non attribuibile al team...
JUMP_MAX_DT_S = 600       # ...se avviene fra due campioni a meno di 10 minuti


def adjust_series(samples):
    """(serie corretta, info): salti non attribuibili tolti dal livello, cali = nuovo punto di partenza.

    `samples` = [(epoch, valore)] ordinati per tempo. La serie corretta ha lo stesso numero di punti dall'ultimo calo.
    """
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
    return out, {"rebaselined_at": rebaselined, "unattributed_pts": sum(d for _, d in jumps), "jumps": jumps}


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


def classify(result, sustainable, *, above=1.2, below=0.8):
    """SOPRA-PACE | SOTTO-PACE | ALLINEATO | ND, con la regola dell'intervallo (vedi la docstring del modulo)."""
    if result is None or not isinstance(sustainable, (int, float)) or sustainable <= 0:
        return "ND"
    if result["lo"] / sustainable > above:
        return "SOPRA-PACE"
    if result["hi"] / sustainable < below:
        return "SOTTO-PACE"
    return "ALLINEATO"
