#!/usr/bin/env python3
"""Event-log di evidenza della manutenzione — validazione e scrittura.

Perché esiste
-------------
I campi di manutenzione delle posizioni (`last_checked`, `last_open_check`,
`updated_at`, `last_actor`) sono **stato last-write-wins**: provano che una
riga è stata riscritta, non che il lavoro sia stato fatto. Un agente che
scrive il timestamp senza aprire l'URL è indistinguibile da uno che ha
lavorato — e quel timestamp è anche la metrica con cui si giudica il suo
lavoro, quindi l'incentivo punta dalla parte sbagliata.

Il principio, unico e non negoziabile:

    `checked` (ho guardato) ≠ `verified` (ho una prova),
    e `verified` non si scrive senza evidenza RI-DERIVABILE DA TERZI.

Ri-derivabile significa status HTTP + hash del contenuto: numeri che un
secondo attore può ricalcolare e confrontare. Una descrizione in prosa non
serve a niente — l'agente può scriverla falsa esattamente come scrive falso
il timestamp. Questo modulo NON impedisce di mentire: rende la menzogna
verificabile a campione. È una differenza di grado, ed è tutta la differenza
che si può ottenere restando dentro il team.

Cosa NON fa
-----------
Non decide se il lavoro è stato fatto. Registra un'affermazione insieme a
ciò che serve per smentirla. Il controllo a campione (ri-scaricare e
riconfrontare gli hash) va fatto FUORI dagli agenti, altrimenti resta
autocertificazione — solo meglio strutturata.

Vedi `docs/internal/architecture/2026-08-03-maintenance-evidence-log-design.md`.
"""

import os

# ── Vocabolari chiusi ────────────────────────────────────────────────────
# Chiusi per scelta: un vocabolario aperto si riempie di sinonimi ("check",
# "checked", "verifica") e rende inaggregabile proprio la metrica per cui la
# tabella esiste.

ACTIONS = (
    "liveness_check",   # l'annuncio esiste ancora?
    "geocode",          # coordinate dell'ufficio
    "logo_fetch",       # logo aziendale
    "website_fetch",    # sito aziendale
    "jd_refresh",       # testo/summary della job description
    "exclude",          # esclusione dal portafoglio
    "rescore",          # ri-valutazione dello Scorer
)

# Due famiglie, due nozioni di prova — perché hanno due modi diversi di
# essere finte.
#
# ESTERNE: toccano una fonte fuori dal DB. Sono verificabili nel senso pieno
# (status HTTP + hash del contenuto), e un terzo può ri-scaricare e
# riconfrontare.
#
# DI GIUDIZIO: non esiste una fonte da interrogare — nessuna URL dice se uno
# score è giusto. Qui la prova possibile è l'IMPRONTA DELL'ARTEFATTO che
# giustifica la decisione (l'hash del breakdown, del motivo di esclusione).
# Non dimostra che il giudizio sia buono; dimostra che è stato RI-FORMULATO.
# Un ri-score con breakdown byte-identico al precedente è, quasi certamente,
# una copia — ed è proprio il no-op che vogliamo poter contare.
EXTERNAL_ACTIONS = (
    "liveness_check", "geocode", "logo_fetch", "website_fetch", "jd_refresh",
)
JUDGEMENT_ACTIONS = ("exclude", "rescore")

OUTCOMES = (
    "confirmed_open",    # verificato: c'è ancora
    "confirmed_closed",  # verificato: non c'è più
    "updated",           # un campo è cambiato
    "unchanged",         # verificato, nulla da cambiare
    "unreachable",       # fonte irraggiungibile
    "skipped",           # non tentato (throttle, fuori scope)
    "failed",            # tentato, errore
)

# Gli esiti che AFFERMANO una verifica. Senza evidenza sono opinioni, e
# `unchanged` è in lista apposta: è l'esito più frequente della manutenzione
# ed è esattamente quello in cui conviene di più non fare niente.
OUTCOMES_REQUIRING_EVIDENCE = (
    "confirmed_open",
    "confirmed_closed",
    "updated",
    "unchanged",
)

EVIDENCE_KINDS = ("http", "api", "manual", "none")

# Kind che valgono come prova ri-derivabile. `manual` e `none` non ci sono:
# descrivono un'affermazione umana o assente, che nessuno può ricalcolare.
EVIDENCE_KINDS_VERIFIABLE = ("http", "api")


class EvidenceError(ValueError):
    """Evidenza mancante o incoerente: la scrittura va rifiutata, non corretta."""


def add_cli_args(parser):
    """Aggiunge i flag di evidenza a un subparser di db_update/db_insert."""
    parser.add_argument(
        "--action", choices=list(ACTIONS),
        help="Operazione di manutenzione in corso (abilita il log di evidenza)")
    parser.add_argument(
        "--outcome", choices=list(OUTCOMES),
        help="Esito dichiarato; se omesso viene dedotto dal diff")
    parser.add_argument(
        "--evidence-kind", choices=list(EVIDENCE_KINDS),
        help="Natura della prova: http/api sono ri-derivabili, manual/none no")
    parser.add_argument("--evidence-url", help="URL effettivamente interrogato")
    parser.add_argument("--evidence-code", type=int, help="Status HTTP della risposta")
    parser.add_argument(
        "--evidence-hash",
        help="sha256 del contenuto normalizzato (permette il riconfronto)")
    parser.add_argument("--duration-ms", type=int, help="Durata dell'operazione")
    return parser


def evidence_from_args(args):
    """Estrae il dict di evidenza dagli argomenti CLI.

    `evidence_kind` si deduce quando l'agente passa una URL senza dichiararlo:
    è la dimenticanza più comune e non vale la pena rifiutare la scrittura per
    un flag ridondante.
    """
    kind = getattr(args, "evidence_kind", None)
    url = getattr(args, "evidence_url", None)
    code = getattr(args, "evidence_code", None)
    if not kind and (url or code is not None):
        kind = "http"
    return {
        "kind": kind,
        "url": url,
        "code": code,
        "hash": getattr(args, "evidence_hash", None),
    }


def _is_verifiable_external(evidence):
    """Evidenza di un'azione ESTERNA: ri-scaricabile e riconfrontabile.

    Serve il tris: un kind verificabile, un puntatore alla fonte e una
    risposta. Uno status 404 è un'evidenza legittima di `confirmed_closed`,
    ma non prova che una posizione sia ancora aperta — per quello la coerenza
    esito/status la controlla `validate`.
    """
    if not evidence:
        return False
    if evidence.get("kind") not in EVIDENCE_KINDS_VERIFIABLE:
        return False
    if not evidence.get("url"):
        return False
    return evidence.get("code") is not None


def _is_verifiable_judgement(evidence):
    """Evidenza di un'azione DI GIUDIZIO: l'impronta dell'artefatto prodotto."""
    return bool(evidence and evidence.get("hash"))


def is_verifiable(action, evidence):
    """L'evidenza regge, per il tipo di azione che si sta dichiarando."""
    if action in JUDGEMENT_ACTIONS:
        return _is_verifiable_judgement(evidence)
    return _is_verifiable_external(evidence)


def validate(action, outcome, evidence):
    """Rifiuta le combinazioni che renderebbero il log inutile.

    Solleva `EvidenceError` con un messaggio che dice cosa passare, non solo
    cosa manca: chi legge l'errore è un agente che deve correggere il comando
    al tentativo successivo.
    """
    if action not in ACTIONS:
        raise EvidenceError(
            f"action '{action}' non valida. Ammesse: {', '.join(ACTIONS)}")
    if outcome not in OUTCOMES:
        raise EvidenceError(
            f"outcome '{outcome}' non valido. Ammessi: {', '.join(OUTCOMES)}")

    if outcome in OUTCOMES_REQUIRING_EVIDENCE and not is_verifiable(action, evidence):
        if action in JUDGEMENT_ACTIONS:
            raise EvidenceError(
                f"outcome '{outcome}' su '{action}' afferma un giudizio "
                "riformulato: passa --evidence-hash <sha256 del breakdown o "
                "del motivo>. Serve a distinguere una rivalutazione vera da "
                "una copia del giudizio precedente. Se non hai rivalutato, "
                "l'esito corretto è 'skipped'.")
        raise EvidenceError(
            f"outcome '{outcome}' afferma una verifica: serve evidenza "
            "ri-derivabile. Passa --evidence-url <url interrogato> e "
            "--evidence-code <status HTTP>, e --evidence-hash <sha256> se hai "
            "letto il contenuto. Se non hai aperto la fonte l'esito corretto è "
            "'skipped' o 'unreachable', non un confirmed."
        )

    code = (evidence or {}).get("code")
    if outcome == "confirmed_open" and isinstance(code, int) and code >= 400:
        raise EvidenceError(
            f"confirmed_open con status {code}: la fonte non ha risposto OK. "
            "Se l'annuncio non c'è più l'esito è 'confirmed_closed'; se la "
            "fonte è caduta è 'unreachable'.")
    if outcome == "confirmed_closed" and isinstance(code, int) and 200 <= code < 300:
        raise EvidenceError(
            f"confirmed_closed con status {code}: la pagina risponde OK. Se è "
            "servita ma l'annuncio non c'è più, passa --evidence-hash del "
            "contenuto che lo dimostra e usa 'updated' su is_open.")


def derive_outcome(action, diffs, evidence):
    """Esito dedotto quando l'agente non lo dichiara.

    Regola volutamente conservativa: senza evidenza che regge non si deduce
    mai un esito che afferma una verifica. Dedurre `unchanged` da un UPDATE a
    vuoto rimetterebbe in piedi esattamente il problema che questa tabella
    esiste per risolvere — una scrittura che si autocertifica.
    """
    ok = is_verifiable(action, evidence)
    if diffs:
        return "updated" if ok else "skipped"
    return "unchanged" if ok else "skipped"


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
    """Scrive UN evento. Non fa commit: sta nella transazione del chiamante.

    Deliberato: l'evento e la modifica che descrive devono atterrare insieme o
    non atterrare affatto. Un log che sopravvive a un UPDATE fallito racconta
    lavoro mai avvenuto, che è il difetto da cui siamo partiti.
    """
    validate(action, outcome, evidence)
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

    `diffs` è una lista di `(field, before, after)`. Il caso "niente è
    cambiato" produce comunque una riga: è il no-op, cioè il dato che serve
    misurare.
    """
    outcome = outcome or derive_outcome(action, diffs, evidence)
    if not diffs:
        record(conn, target_type, target_id, action, outcome,
               evidence=evidence, duration_ms=duration_ms, by_agent=by_agent)
        return 1
    for field, before, after in diffs:
        record(conn, target_type, target_id, action, outcome, field=field,
               before=before, after=after, evidence=evidence,
               duration_ms=duration_ms, by_agent=by_agent)
    return len(diffs)


# ── Regola dura sui campi `*_verified` ───────────────────────────────────
# Un campo che si chiama "verified" è una promessa fatta a chi legge la
# dashboard. Senza questo controllo la prossima passata automatica si
# dichiara verifica esattamente come ha fatto quella che ha portato
# office_geocoded al 100% e office_verified al 2,5%.

VERIFIED_FIELDS = ("office_verified",)


def check_verified_claim(field, value, evidence):
    """Chi scrive `<campo>_verified = 1` deve avere una prova 2xx."""
    if field not in VERIFIED_FIELDS:
        return
    truthy = value in (1, "1", True, "true")
    if not truthy:
        return
    code = (evidence or {}).get("code")
    if (not _is_verifiable_external(evidence)
            or not (isinstance(code, int) and 200 <= code < 300)):
        raise EvidenceError(
            f"{field}=true richiede una verifica dimostrabile: --evidence-url "
            "e --evidence-code 2xx (più --evidence-hash se hai letto il "
            "contenuto). Per una geocodifica automatica non verificata a mano "
            "usa --office-geocoded true e lascia office_verified com'è.")
