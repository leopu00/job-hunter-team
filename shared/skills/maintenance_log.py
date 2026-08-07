#!/usr/bin/env python3
"""Storico dei controlli di manutenzione, e protezione dell'incerto.

Due cose, entrambe semplici.

1. STORICO — quando una posizione è stata trovata e quando è stata
   ricontrollata, con che esito. Oggi `last_checked` tiene solo l'ULTIMA data:
   la storia si sovrascrive ad ogni giro, quindi non si può rispondere a
   "quante volte l'abbiamo guardata", "da quanto non la tocchiamo",
   "quante volte non siamo riusciti a verificarla". Qui ogni controllo lascia
   una riga.

2. L'INCERTO NON SI BUTTA — se un agente non riesce ad accertare se
   un'offerta è ancora aperta, quell'offerta **resta viva**. Non sapere non è
   sapere che è scaduta, e una posizione chiusa per dubbio è un'opportunità
   persa senza motivo. La skill `recheck-liveness` lo dice già
   (`OPEN_UNVERIFIED` → lascia `is_open` invariato), ma è prosa: nessuna riga
   di codice lo impedisce. Qui lo impedisce.

I campi `evidence_*` sono OPZIONALI: servono a ricordare cosa aveva risposto
la fonte (status, URL) quando serve capire perché un controllo è andato come
è andato. Non sono un obbligo e non gatekeepano niente.
"""

import os

# ── Vocabolari chiusi ────────────────────────────────────────────────────
# Chiusi perché un vocabolario aperto si riempie di sinonimi ("check",
# "checked", "verifica") e rende inaggregabile proprio il conteggio per cui
# lo storico esiste.

ACTIONS = (
    "liveness_check",   # l'annuncio esiste ancora?
    "geocode",          # coordinate dell'ufficio
    "logo_fetch",       # logo aziendale
    "website_fetch",    # sito aziendale
    "jd_refresh",       # testo/summary della job description
    "exclude",          # esclusione dal portafoglio
    "rescore",          # ri-valutazione dello Scorer
)

OUTCOMES = (
    "confirmed_open",    # verificato: c'è ancora
    "confirmed_closed",  # verificato: non c'è più
    "inconclusive",      # NON si è riusciti a stabilirlo → la posizione resta viva
    "updated",           # un campo è cambiato
    "unchanged",         # nulla da cambiare
    "unreachable",       # fonte irraggiungibile
    "skipped",           # non tentato (throttle, fuori scope)
    "failed",            # tentato, errore
)

# Esiti che dicono "non lo so". È la categoria che protegge il portafoglio:
# da qui non si può concludere niente sulla posizione.
INCONCLUSIVE_OUTCOMES = ("inconclusive", "unreachable", "failed", "skipped")

EVIDENCE_KINDS = ("http", "api", "manual", "none")


class MaintenanceError(ValueError):
    """Scrittura incoerente con l'esito dichiarato: va rifiutata, non corretta."""


def add_cli_args(parser):
    """Aggiunge i flag dello storico a un subparser di db_update/db_insert."""
    parser.add_argument(
        "--action", choices=list(ACTIONS),
        help="Maintenance action in progress (records the check in history)")
    parser.add_argument(
        "--outcome", choices=list(OUTCOMES),
        help="Check outcome. Use 'inconclusive' when you could not establish "
             "whether the listing is open; the position stays active.")
    parser.add_argument("--evidence-kind", choices=list(EVIDENCE_KINDS),
                        help="Type of evidence source consulted (optional)")
    parser.add_argument("--evidence-url", help="URL queried (optional)")
    parser.add_argument("--evidence-code", type=int, help="HTTP status (optional)")
    parser.add_argument("--evidence-hash", help="Content hash (optional)")
    parser.add_argument("--duration-ms", type=int, help="Operation duration")
    return parser


def evidence_from_args(args):
    """Estrae i dati della fonte dagli argomenti CLI. Tutto opzionale."""
    kind = getattr(args, "evidence_kind", None)
    url = getattr(args, "evidence_url", None)
    code = getattr(args, "evidence_code", None)
    if not kind and (url or code is not None):
        kind = "http"
    return {"kind": kind, "url": url, "code": code,
            "hash": getattr(args, "evidence_hash", None)}


# ── La regola che protegge il portafoglio ────────────────────────────────
#
# Chiudere una posizione è l'unica operazione di manutenzione IRREVERSIBILE
# nei fatti: una volta fuori dal radar non la si guarda più, e se era ancora
# aperta l'occasione è persa in silenzio. Tutto il resto (una coordinata
# sbagliata, un logo mancante) si corregge al giro dopo.
#
# Quindi: si chiude solo se si SA che è chiusa. Un controllo che non è
# riuscito a stabilirlo lascia le cose come stanno e si ritenta.

CLOSING_WRITES = {
    "is_open": ("false", "0", 0, False),
    "status": ("excluded", "expired"),
}


def check_closing_write(field, value, outcome):
    """Vieta di chiudere una posizione su un controllo non concluso."""
    if outcome not in INCONCLUSIVE_OUTCOMES:
        return
    closing = CLOSING_WRITES.get(field)
    if not closing or value not in closing:
        return
    raise MaintenanceError(
        f"outcome '{outcome}' means you could NOT verify the result, while "
        f"'{field}={value}' would close the position. Not knowing does not "
        "prove it expired: closing on doubt can silently lose an opportunity. "
        "Keep it active — the check remains in history and will be retried. "
        "Close it only with outcome 'confirmed_closed'."
    )


def validate(action, outcome):
    if action not in ACTIONS:
        raise MaintenanceError(
            f"invalid action '{action}'. Allowed: {', '.join(ACTIONS)}")
    if outcome not in OUTCOMES:
        raise MaintenanceError(
            f"invalid outcome '{outcome}'. Allowed: {', '.join(OUTCOMES)}")


def derive_outcome(diffs):
    """Esito dedotto quando l'agente non lo dichiara: ha cambiato qualcosa o no."""
    return "updated" if diffs else "unchanged"


def actor():
    """Chi sta scrivendo. Stessa fonte di `positions.last_actor`."""
    return (os.environ.get("JHT_AGENT_NAME")
            or os.environ.get("JHT_AGENT_DIR", "").split("/")[-1]
            or "unknown")


def _as_text(value):
    """Valore in stringa per before/after. `None` resta `None` (≠ 'None')."""
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def record(conn, target_type, target_id, action, outcome, *,
           field=None, before=None, after=None, evidence=None,
           duration_ms=None, by_agent=None):
    """Scrive UNA riga di storico. Non fa commit: sta nella transazione del
    chiamante, così il controllo e la modifica che descrive atterrano insieme.
    """
    validate(action, outcome)
    ev = evidence or {}
    conn.execute(
        "INSERT INTO maintenance_events "
        "(by_agent, target_type, target_id, action, outcome, field, before, "
        " after, evidence_kind, evidence_url, evidence_code, evidence_hash, "
        " duration_ms) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (by_agent or actor(), target_type, target_id, action, outcome, field,
         _as_text(before), _as_text(after), ev.get("kind"), ev.get("url"),
         ev.get("code"), ev.get("hash"), duration_ms),
    )


def record_diffs(conn, target_type, target_id, action, diffs, *,
                 outcome=None, evidence=None, duration_ms=None, by_agent=None):
    """Un evento per campo cambiato; uno solo se non è cambiato niente.

    `diffs` è una lista di `(field, before, after)`. Anche il caso "niente è
    cambiato" lascia una riga: serve a sapere che la posizione è stata
    guardata, che è metà del punto di tenere uno storico.
    """
    outcome = outcome or derive_outcome(diffs)
    for field, _before, after in diffs:
        check_closing_write(field, after, outcome)
    if not diffs:
        record(conn, target_type, target_id, action, outcome,
               evidence=evidence, duration_ms=duration_ms, by_agent=by_agent)
        return 1
    for field, before, after in diffs:
        record(conn, target_type, target_id, action, outcome, field=field,
               before=before, after=after, evidence=evidence,
               duration_ms=duration_ms, by_agent=by_agent)
    return len(diffs)


def unverified_streak(conn, position_id):
    """Quanti controlli di liveness di fila non hanno concluso nulla.

    Serve a distinguere "non l'abbiamo ancora guardata" da "la guardiamo da
    settimane e non riusciamo mai a leggerla": la seconda è un problema di
    fonte da segnalare, non una posizione da buttare.
    """
    rows = conn.execute(
        "SELECT outcome FROM maintenance_events "
        "WHERE target_type = 'position' AND target_id = ? "
        "AND action = 'liveness_check' ORDER BY id DESC", (position_id,)
    ).fetchall()
    streak = 0
    for (outcome,) in rows:
        if outcome in INCONCLUSIVE_OUTCOMES:
            streak += 1
        else:
            break
    return streak
