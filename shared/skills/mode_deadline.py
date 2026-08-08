#!/usr/bin/env python3
"""
mode_deadline.py — una modalità può SCADERE, e allora torna a `search`.

## Perché esiste ([SAVING-MODE-HAS-NO-DEADLINE], 2026-08)

Il budget settimanale è una **finestra, non un saldo**: ciò che non si spende
al reset viene distrutto, non riportato. Quindi un `saving` messo lunedì e
dimenticato non conserva niente — butta via l'intero ciclo, mentre `burn_mode`
segnala uno spreco che quella stessa modalità gli vieta di evitare. Il nome
peggiora le cose: «risparmio» promette conservazione e consegna distruzione
ogni volta che la finestra non è vicina alla fine.

È la stessa lezione dei 18 giorni di modalità cura che nessuno aveva notato
([MODE-INJECTION-HOURLY-PROMPT]): **nessuna modalità deve durare per inerzia.**
Chi la sceglie può dire fino a quando, e alla scadenza si torna al default
senza che nessuno debba ricordarsene.

## Il contratto

Chiave opzionale `"mode_until"` in `profile/capitano-maintenance.json`,
accanto a `"mode"`:

    {"mode": "saving", "mode_until": "2026-08-10T18:00:00Z", "orders": {...}}

Assente = comportamento storico (la modalità dura finché l'utente la toglie).
Presente e passata = la modalità è FINITA: si legge `search`.

Due scelte che vale la pena dichiarare:

  • **Si valuta in lettura, non con un processo che riscrive il file.** La
    scadenza è una funzione dell'orologio: chiunque legga il file arriva alla
    stessa conclusione nello stesso istante, senza dipendere da un demone che
    potrebbe non girare. Il file resta com'è — dice ancora `saving` — e chi lo
    legge sa che quell'ordine è scaduto.
  • **Scadono anche gli `orders` di quella modalità.** «saving fino a venerdì»
    è UN ordine con una fine: lasciare in piedi `stop_search: true` dopo la
    scadenza significherebbe tornare a `search` e non cercare comunque, cioè
    non tornare affatto.

Un `mode_until` illeggibile (formato sbagliato) NON scade e NON invalida la
modalità: la direzione sicura per un freno di spesa è trattare l'ignoto come
ordine ancora attivo, e dirlo.

Uso come libreria:
    import mode_deadline
    mode, expired = mode_deadline.effective_mode(mode, deadline)
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

# La chiave nel file e la modalità di ritorno. Il default del contratto è
# `search`, lo stesso che vale quando il file non esiste.
DEADLINE_KEY = "mode_until"
FALLBACK_MODE = "search"


def parse_deadline(value) -> Optional[datetime]:
    """ISO 8601 → datetime tz-aware (UTC), o None se assente/illeggibile.

    Accetta la `Z` finale (che `fromisoformat` non digerisce prima di 3.11) e
    una data nuda (`2026-08-10` = mezzanotte). Un timestamp senza timezone si
    interpreta come UTC: è la convenzione con cui il resto del sistema scrive
    gli istanti, e indovinare il fuso locale del container qui produrrebbe una
    scadenza diversa da quella che l'utente ha visto.
    """
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip()
    if raw.endswith(("Z", "z")):
        raw = raw[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def is_expired(deadline: Optional[datetime], now: Optional[datetime] = None) -> bool:
    """True solo con una scadenza VALIDA e già passata."""
    if deadline is None:
        return False
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now >= deadline


def effective_mode(mode: str, deadline: Optional[datetime],
                   now: Optional[datetime] = None):
    """`(modalità in vigore ADESSO, è scaduta?)`.

    Non tocca il file e non decide niente sull'ignoto: un `mode_until` non
    interpretabile arriva qui come `None` e la modalità resta quella scritta.
    """
    if is_expired(deadline, now):
        return FALLBACK_MODE, True
    return mode, False


def remaining_text(deadline: Optional[datetime],
                   now: Optional[datetime] = None) -> str:
    """Quanto manca, in una forma che si legge in un pane tmux ("2g 3h", "45m").

    Stringa vuota se non c'è scadenza; "expired" se è già passata — chi
    compone il banner ci scrive attorno la frase, qui c'è solo il numero.
    """
    if deadline is None:
        return ""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    delta = deadline - now
    minutes = int(delta.total_seconds() // 60)
    if minutes <= 0:
        return "expired"
    days, rem = divmod(minutes, 1440)
    hours, mins = divmod(rem, 60)
    if days:
        return f"{days}d {hours}h"
    if hours:
        return f"{hours}h {mins:02d}m"
    return f"{mins}m"
