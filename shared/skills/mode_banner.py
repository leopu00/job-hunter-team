#!/usr/bin/env python3
"""
mode_banner.py — la MODALITÀ CORRENTE composta DA DISCO, per essere iniettata.

## Perché esiste ([MODE-INJECTION-HOURLY-PROMPT], decisione utente 2026-07-30)

L'11/07/2026 l'utente ha messo un team in manutenzione (`stop_search: true`).
L'ordine è stato scritto in `profile/capitano-maintenance.json` e recepito: il
12/07 il diario del Capitano registra uno spawn Scout **soppresso** citandolo.
Il 13/07, dopo un refresh di contesto, l'ordine è sparito dalla memoria
operativa — e per **18 giorni** il team ha lavorato in modalità normale (183
posizioni sorgente, weekly bruciato al 100% due volte) finché l'utente non l'ha
riemesso a mano il 29/07.

Le tre difese esistenti hanno ceduto tutte per lo stesso motivo: **dipendono da
qualcuno che si ricordi di LEGGERE.** C-18 («rileggi il file a ogni apertura di
finestra») è un obbligo di prompt, e si affida alla stessa memoria che il
refresh cancella. La bacheca `team_directives` è la fonte di verità che C-18
indica, ma nessun processo la popola. Il `[RESUME]` del Dottore la porterebbe
avanti, ma il Dottore è un agente e il suo round può saltare.

Questo modulo ribalta la direzione: **compone l'ordine, e chi lo consegna è un
processo deterministico.** Non aggiunge una fonte di verità — legge quelle che
già esistono, ogni volta che gli si chiede, senza cache:

  1. `$JHT_HOME/profile/capitano-maintenance.json`  → modalità e `orders`
  2. `team_directives` con `status='active'` (jobs.db, SOLA LETTURA) → gli
     ordini permanenti dell'utente
  3. i flag operativi già noti al sistema → `.team-halted.flag`,
     `.team-standby.flag`, `daily-halt.flag`, `.weekly-halt.flag`,
     `.burn-intent.flag`

## Chi la inietta

  • `.launcher/heartbeat-bridge.py` — in coda al battito orario al Capitano.
    Un processo Python: non dimentica, non salta i giri, non costa un turno di
    modello in più (il messaggio parte comunque).
  • la skill `session-refresh` (Dottore) — in coda al `[RESUME]` del Capitano,
    letta da disco e non dal contesto che sta buttando. Doppio canale: il
    bridge copre il TEMPO, il resume copre l'ISTANTE del refresh.

I **worker non la ricevono**: la modalità la applica il Capitano assegnando le
code, e un worker che riparte guarda la coda che gli è stata assegnata.

## Due regole che non si negoziano

**Mai vuota.** `banner()` ritorna sempre una sezione, anche a modalità di
default (`MODE: search`). L'assenza della sezione deve poter significare solo
«bridge rotto» — mai «modalità di default», altrimenti si ricrea l'ambiguità
silenzio=default che è la causa dell'incidente.

**Chiude dichiarando chi vince.** L'ultima riga dice che in caso di contrasto
vince il file. Non è decorazione: dopo un refresh il Capitano ha un contesto
pulito che *contraddice* l'ordine, e deve sapere quale dei due è autorevole.

Corollario: un `capitano-maintenance.json` presente ma **illeggibile** non
diventa `search`. Si dichiara `MODE: sconosciuto` e si tratta come un ordine
attivo — la direzione sicura è far leggere il file a un umano, non dedurre che
non ci fosse nessun ordine.

## Le modalità (contratto 2026-08-03)

`"mode"` è un enum chiuso: `search` (default, assenza del file), `harvest`,
`care` (ex `maintenance`), `calibration`, `saving`. Ogni modalità dichiara
QUATTRO cose — code attive, cosa è sospeso, priorità di budget, condizione di
uscita — e il banner le trasmette TUTTE, non solo il nome: il manuale completo
è la skill `team-modes` (agents/_skills/), referenziata dal file identità del
Capitano. La condizione di uscita è la novità che chiude il buco storico
(nessuna modalità finiva da sola): dove è misurabile si valuta in SOLA LETTURA
sul DB e il banner dichiara «LAVORO ESAURITO»; dove non lo è, degrada in un
esplicito «non valutabile» — mai in un falso finito. Il banner non cambia MAI
modalità: la scelta resta dell'utente, il banner rompe solo il silenzio.

La chiave opzionale `"mode_until"` aggiunge la condizione di uscita che non
dipende dal lavoro residuo ([SAVING-MODE-HAS-NO-DEADLINE]): passata quella
data la modalità torna `search` **da sola**, insieme ai suoi `orders`, e il
banner lo dichiara. Non è il banner a cambiare modalità — la scadenza l'ha
scelta l'utente, qui si legge un orologio (`mode_deadline.py`, condiviso con
`enrichment_policy.current_mode()` perché le due letture devono concludere la
stessa cosa nello stesso istante).

Uso:
  python3 mode_banner.py line          # una riga (per tmux: mai newline)
  python3 mode_banner.py show          # multi-riga, leggibile
  python3 mode_banner.py json          # i fatti grezzi
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sqlite3
import sys
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# ── L'enum chiuso delle modalità (contratto 2026-08-03) ───────────────────
# Cinque valori nel file, chiave `"mode"`. L'assenza del file È `search`; i
# valori legacy (`normal`, `maintenance`) vengono canonicalizzati ma restano
# visibili nel banner — il file su una VPS in produzione li porta ancora.
MODE_SEARCH = "search"
MODE_HARVEST = "harvest"
MODE_CARE = "care"
MODE_CALIBRATION = "calibration"
MODE_SAVING = "saving"
MODES = (MODE_SEARCH, MODE_HARVEST, MODE_CARE, MODE_CALIBRATION, MODE_SAVING)
# Alias storici: `normal` era il "nessun file", `maintenance` è la cura di
# C-18 prima della rinomina 2026-07-30. Stessa modalità, nome canonico nuovo.
MODE_NORMAL = "normal"
MODE_MAINTENANCE = "maintenance"
LEGACY_MODES = {MODE_NORMAL: MODE_SEARCH, MODE_MAINTENANCE: MODE_CARE}
MODE_UNKNOWN = "sconosciuto"

MODE_LABELS = {
    MODE_SEARCH: "search",
    MODE_HARVEST: "harvest",
    MODE_CARE: "care",
    MODE_CALIBRATION: "calibration",
    MODE_SAVING: "saving",
}

# Le QUATTRO dichiarazioni di ogni modalità (code attive / sospeso / budget /
# uscita) in forma compatta: è la specifica che il battito orario trasmette.
# Il testo lungo — cosa assegnare, cosa spawnare, come si compone con C-25 —
# vive nella skill `team-modes`; qui deve stare in un messaggio DIGITATO.
MODE_SPECS = {
    MODE_SEARCH: {
        "code": "full pipeline: scout → analysis → scoring "
                "(Writer/Critic on demand, C-10)",
        "sospeso": "nothing — C-05/C-05c (anti-idle sourcing) are active",
        "budget": "sourcing first, then analysis/scoring toward SCORED "
                  "positions",
        "uscita": "none: continuous mode; only the user changes it",
    },
    MODE_HARVEST: {
        "code": "turn the best positions ALREADY found into CVs (Writer "
                "on demand + Critic; pre-CV liveness)",
        "sospeso": "sourcing: NO Scouts (C-05/C-05c suspended; `new` queue "
                   "empty BY DESIGN)",
        "budget": "Writer/Critic first; Analyst only for the liveness "
                  "pre-check",
        "uscita": "when no live position above the threshold remains without a CV",
    },
    MODE_CARE: {
        "code": "scheduled recheck (14 days, score ≥ 70, best first) + "
                "geocode-missing + logo-missing + discard expired positions (C-18)",
        "sospeso": "sourcing when stop_search=true (C-05/C-05c suspended)",
        "budget": "portfolio care spread across active hours; CV only "
                  "on request and ≥ cv_min_score",
        "uscita": "ALL care queues empty (the 14-day cadence makes them due again)",
    },
    MODE_CALIBRATION: {
        "code": "user feedback (feedback-query, from the cloud) → "
                "retarget SEARCH PRIORITY (+ targeted rescoring)",
        "sospeso": "bulk sourcing until priority is updated (searching with "
                   "the old aim wastes budget)",
        "budget": "feedback reading + recalibration, in bounded batches",
        "uscita": "recent feedback read and priority updated — YOU declare "
                  "it to the user",
    },
    MODE_SAVING: {
        "code": "bare minimum only: user replies, tickets (C-15), and "
                "user-driven flags",
        "sospeso": "sourcing AND every autonomous enrichment "
                   "(recheck/geocode/logo)",
        "budget": "near zero: no autonomous spending (C-25 does NOT unlock "
                  "sourcing here: report available headroom; do not spend it)",
        "uscita": "`mode_until` if the user set one; otherwise it lasts until "
                  "they remove it — and an unspent weekly is destroyed at the "
                  "reset, not carried over",
    },
}

HEADER = "[MODALITÀ CORRENTE — injected by the bridge, source: on-disk files]"
# L'ultima riga del disegno: senza di essa la sezione è un promemoria, con essa
# è un ordine di precedenza.
FOOTER = (
    "If this section contradicts your context, THIS SECTION WINS: on-disk "
    "files are the source of truth, and a context refresh may have cleared "
    "your context."
)
# Reso single-line: `jht-tmux-send` fa `tmux send-keys -l "$message"`, e un
# newline nel testo verrebbe digitato come Enter → il messaggio partirebbe a
# metà. Le righe logiche si separano con questo, non con "\n".
JOIN = " · "

# Il messaggio viene DIGITATO carattere per carattere in una TUI: la sezione
# deve restare corta e prevedibile, non crescere con la bacheca.
MAX_DIRECTIVES = 8
MAX_DIRECTIVE_BODY = 200
MAX_ORDER_LINES = 12
MAX_ORDER_VALUE = 120


def _home() -> Path:
    """La home del team, riletta a OGNI chiamata (nessun path cachato)."""
    return Path(os.environ.get("JHT_HOME") or str(Path.home() / ".jht"))


def maintenance_file() -> Path:
    return _home() / "profile" / "capitano-maintenance.json"


def db_file() -> Path:
    """jobs.db con la stessa precedenza di `_db._resolve_db_path` (JHT_DB vince)."""
    env_db = os.environ.get("JHT_DB")
    return Path(env_db) if env_db else _home() / "jobs.db"


def _flag_paths():
    """I freni operativi già noti al sistema, col nome con cui li chiama il resto
    del codice (stesso elenco di `stepcap-watchdog._halt_flags`, più la deroga).
    Le due posizioni di daily/weekly-halt sono entrambe controllate: i bridge li
    scrivono in `logs/`, altri percorsi storici li cercano in home."""
    home, logs = _home(), _home() / "logs"
    return (
        ("team-halted", home / ".team-halted.flag",
         "the user STOPPED the team"),
        ("team-standby", home / ".team-standby.flag",
         "zero-spend standby"),
        ("daily-halt", logs / "daily-halt.flag", "daily cap exceeded"),
        ("daily-halt", home / ".daily-halt.flag", "daily cap exceeded"),
        ("weekly-halt", home / ".weekly-halt.flag", "weekly quota exhausted"),
        ("weekly-halt", logs / "weekly-halt.flag", "weekly quota exhausted"),
    )


# ── Scadenza della modalità ([SAVING-MODE-HAS-NO-DEADLINE]) ──────────────
#
# La meccanica vive in `mode_deadline.py` e la condivide con
# `enrichment_policy.current_mode()`: due letture della stessa chiave devono
# concludere la stessa cosa nello stesso istante, altrimenti il freno di spesa
# e il banner raccontano al Capitano due modalità diverse. Se il modulo non è
# caricabile la scadenza semplicemente non si applica (fail-safe: la modalità
# scritta resta in vigore, che è il comportamento storico).

def _deadline_key() -> str:
    mod = _sibling("mode_deadline")
    return getattr(mod, "DEADLINE_KEY", "mode_until") if mod else "mode_until"


def _parse_deadline(value):
    mod = _sibling("mode_deadline")
    if mod is None:
        return None
    try:
        return mod.parse_deadline(value)
    except Exception:      # noqa: BLE001 — una scadenza non abbatte un banner
        return None


def _deadline_expired(deadline, now=None) -> bool:
    mod = _sibling("mode_deadline")
    if mod is None or deadline is None:
        return False
    try:
        return bool(mod.is_expired(deadline, now))
    except Exception:      # noqa: BLE001
        return False


def _deadline_remaining(deadline, now=None) -> str:
    mod = _sibling("mode_deadline")
    if mod is None or deadline is None:
        return ""
    try:
        return mod.remaining_text(deadline, now)
    except Exception:      # noqa: BLE001
        return ""


# ── Lettura della modalità ────────────────────────────────────────────────

def read_maintenance() -> dict:
    """Cosa dice `capitano-maintenance.json` ADESSO.

    Ritorna sempre un dict con `{"exists", "readable", "mode", "orders",
    "since"}`. `mode` è il valore GREZZO del file (assenza = `search`, il
    default del contratto); la canonicalizzazione degli alias legacy la fa
    `snapshot()`. Un file presente ma rotto NON diventa `search`: `readable`
    è False e il chiamante lo dichiara `sconosciuto`.
    """
    path = maintenance_file()
    out = {"exists": False, "readable": False, "mode": MODE_SEARCH,
           "orders": {}, "since": None, "path": str(path),
           "mode_until_raw": None, "mode_until": None}
    try:
        raw = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return out
    out["exists"] = True
    # `since` dall'mtime: il file non porta un timestamp, e il disco lo sa.
    try:
        out["since"] = datetime.fromtimestamp(
            path.stat().st_mtime, tz=timezone.utc
        ).strftime("%Y-%m-%d %H:%M UTC")
    except OSError:
        pass
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return out
    if not isinstance(data, dict):
        return out
    out["readable"] = True
    mode = data.get("mode")
    out["mode"] = mode.strip() if isinstance(mode, str) and mode.strip() else MODE_SEARCH
    orders = data.get("orders")
    out["orders"] = orders if isinstance(orders, dict) else {}
    # `mode_until` GREZZA e interpretata: la seconda è None anche quando la
    # prima c'è ma non si legge, e le due insieme permettono al banner di dire
    # «c'è una scadenza che non capisco» invece di ignorarla in silenzio.
    raw_until = data.get(_deadline_key())
    out["mode_until_raw"] = raw_until if isinstance(raw_until, str) else None
    out["mode_until"] = _parse_deadline(raw_until)
    return out


# ── Lettura della bacheca (sola lettura, mai crea il DB) ──────────────────

def read_directives(limit: int = MAX_DIRECTIVES) -> dict:
    """Le direttive ATTIVE dalla bacheca `team_directives`.

    Apre sqlite in `mode=ro`: un bridge non deve poter creare un jobs.db né
    scriverci. Ritorna `{"readable", "rows", "total"}` — DB assente o tabella
    non ancora migrata NON è «nessuna direttiva» ma «non leggibile», perché
    dire "nessuna" quando non si è potuto guardare è la bugia che questo
    modulo esiste per non raccontare.
    """
    path = db_file()
    out = {"readable": False, "rows": [], "total": 0}
    if not path.exists():
        return out
    uri = "file:%s?mode=ro" % urllib.parse.quote(str(path))
    try:
        conn = sqlite3.connect(uri, uri=True, timeout=2)
    except sqlite3.Error:
        return out
    try:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT id, body, kind, created_at, updated_at FROM team_directives WHERE status = 'active' "
            "ORDER BY sort_order ASC, created_at ASC"
        ).fetchall()
    except sqlite3.Error:
        return out
    finally:
        try:
            conn.close()
        except sqlite3.Error:
            pass
    out["readable"] = True
    out["total"] = len(rows)
    policy = _sibling("provider_directive_policy")
    if policy is None:
        # Fail closed: a missing policy must never make provider instructions
        # executable again. The board remains readable, but no raw directive
        # is injected until the boundary can be loaded.
        out["rows"] = [
            {"id": r["id"], "kind": r["kind"],
             "body": "[IGNORED: directive policy unavailable]",
             "provider_instruction_ignored": True}
            for r in rows[:max(0, limit)]
        ]
        return out
    for r in rows[:max(0, limit)]:
        body, ignored = policy.for_prompt(r["body"])
        if len(body) > MAX_DIRECTIVE_BODY:
            body = body[:MAX_DIRECTIVE_BODY - 1].rstrip() + "…"
        out["rows"].append({
            "id": r["id"], "kind": r["kind"], "body": body,
            "provider_instruction_ignored": ignored,
            "created_at": r["created_at"], "updated_at": r["updated_at"],
        })
    return out


# ── Lettura dei freni ─────────────────────────────────────────────────────

_SIBLINGS: dict = {}


def _sibling(name: str):
    """Import per path di una skill sorella (container prima, repo fallback).

    Si cacha il MODULO (l'exec costa), mai lo stato: i path del modulo caricato
    vengono ri-puntati a `_home()` a ogni chiamata, così una lettura non può
    finire sulla home di un'altra installazione né restare congelata su quella
    risolta al primo import.
    """
    if name in _SIBLINGS:
        return _SIBLINGS[name]
    mod = None
    for cand in (Path("/app/shared/skills") / f"{name}.py",
                 Path(__file__).resolve().parent / f"{name}.py"):
        try:
            if not cand.exists():
                continue
            spec = importlib.util.spec_from_file_location(name, cand)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            break
        except (OSError, ImportError, AttributeError, SyntaxError, ValueError):
            mod = None
            continue
    _SIBLINGS[name] = mod
    return mod


def _burn_intent() -> Optional[dict]:
    """Stato della deroga di spesa, o None se non determinabile.

    La logica di scadenza resta UNA sola (`burn_intent.status`): qui si sposta
    solo il path del flag sulla home corrente.
    """
    mod = _sibling("burn_intent")
    if mod is None:
        return None
    try:
        mod.INTENT_FLAG = _home() / ".burn-intent.flag"
        st = mod.status()
        return st if isinstance(st, dict) else None
    except Exception:      # noqa: BLE001 — un promemoria non abbatte un bridge
        return None


def read_flags() -> list:
    """I freni/deroghe attivi ADESSO, come `[{"name", "why"}]`.

    Non è una policy: è contesto. Il Capitano che legge «daily-halt attivo» sa
    perché il team è fermo senza doverlo dedurre da quello che non succede.
    """
    seen, out = set(), []
    for name, path, why in _flag_paths():
        if name in seen:
            continue
        try:
            if path.exists():
                seen.add(name)
                out.append({"name": name, "why": why})
        except OSError:
            continue
    bi = _burn_intent()
    if bi and bi.get("active"):
        out.append({
            "name": "burn-intent",
            "why": "user spending override, expires in %s min"
                   % bi.get("remaining_min"),
        })
    return out


# ── Condizione di uscita (sola lettura, mai crea né scrive) ───────────────
# La dichiarazione (4) di ogni modalità: quando il suo lavoro è ESAURITO.
# È il pezzo che storicamente non esisteva — nessuna modalità finiva da sola,
# ed è così che un team è restato 18 giorni in manutenzione senza che nessuno
# se ne accorgesse. Il banner non cambia mai modalità (la scelta è
# dell'utente): DICE quando il lavoro è finito, e il Capitano lo riferisce.
#
# Regola di degradazione: un conteggio non ottenibile è "non valutabile",
# MAI un falso «finito» — stessa etica di `read_directives` («dire "nessuna"
# quando non si è potuto guardare è la bugia che questo modulo esiste per non
# raccontare»). I conteggi sono STIME RO su SQL proprio: la verità operativa
# restano le code di `db_query.py` (che applicano la policy in codice); qui
# la policy si rilegge dal JSON con gli stessi default documentati.

EXIT_DONE = "done"
EXIT_PENDING = "pending"
EXIT_CONTINUOUS = "continuous"
EXIT_UNAVAILABLE = "unavailable"

# Soglia CV di default in harvest quando `orders.cv_min_score` manca: la leva
# storica del raccolto (score ≥ 75). In cura il default resta 90 (C-18), ma
# lì la soglia governa la scrittura, non l'uscita.
HARVEST_DEFAULT_CV_MIN_SCORE = 75
# Default documentati di enrichment-policy.json (DEFAULT_POLICY in
# enrichment_policy.py): qui si rileggono dal JSON senza importare il modulo.
CARE_RECHECK_DEFAULT_MIN_SCORE = 70
CARE_RECHECK_DEFAULT_OLDER_THAN_DAYS = 14


def _db_ro_conn():
    """Connessione sqlite in sola lettura a jobs.db, o None. Come
    `read_directives`: un banner non deve poter creare un DB né scriverci."""
    path = db_file()
    try:
        if not path.exists():
            return None
    except OSError:
        return None
    uri = "file:%s?mode=ro" % urllib.parse.quote(str(path))
    try:
        return sqlite3.connect(uri, uri=True, timeout=2)
    except sqlite3.Error:
        return None


def _count(conn, sql: str, params=()) -> Optional[int]:
    """COUNT scalare, o None su qualunque errore (schema vecchio compreso)."""
    try:
        row = conn.execute(sql, params).fetchone()
        return int(row[0]) if row else None
    except (sqlite3.Error, TypeError, ValueError):
        return None


def _enrichment_policy() -> dict:
    """`profile/enrichment-policy.json` letto direttamente, con i default di
    `enrichment_policy.DEFAULT_POLICY`. File assente o rotto = default (tutte
    le code attive): è lo stesso comportamento di `load_policy()`."""
    out = {
        "economy": False,
        "logo": {"enabled": True, "min_score": None},
        "geocode_missing": {"enabled": True, "min_score": None,
                            "non_remote_only": True},
        "recheck_weekly": {"enabled": True,
                           "min_score": CARE_RECHECK_DEFAULT_MIN_SCORE,
                           "older_than_days":
                               CARE_RECHECK_DEFAULT_OLDER_THAN_DAYS},
    }
    try:
        data = json.loads((_home() / "profile" / "enrichment-policy.json")
                          .read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return out
    if not isinstance(data, dict):
        return out
    if isinstance(data.get("economy"), bool):
        out["economy"] = data["economy"]
    for kind in ("logo", "geocode_missing", "recheck_weekly"):
        sub = data.get(kind)
        if not isinstance(sub, dict):
            continue
        for key, val in sub.items():
            if key in out[kind]:
                out[kind][key] = val
    return out


def _care_queue_counts(conn) -> dict:
    """Stima RO delle quattro code della cura. Valori: int, la stringa
    "off" (spenta da policy — per l'uscita conta come esaurita, stato
    voluto), oppure None (non contabile)."""
    pol = _enrichment_policy()
    economy = bool(pol.get("economy"))
    out = {}

    rw = pol["recheck_weekly"]
    if economy or not rw.get("enabled", True):
        out["recheck"] = "off"
    else:
        try:
            ms = int(rw.get("min_score") or CARE_RECHECK_DEFAULT_MIN_SCORE)
            days = int(rw.get("older_than_days")
                       or CARE_RECHECK_DEFAULT_OLDER_THAN_DAYS)
        except (TypeError, ValueError):
            ms = CARE_RECHECK_DEFAULT_MIN_SCORE
            days = CARE_RECHECK_DEFAULT_OLDER_THAN_DAYS
        # Stessa anzianità della coda `recheck_due_rows` (db_query.py): l'ultima
        # verifica è la PIÙ RECENTE fra `last_checked` e `last_open_check`
        # ([RECHECK-MUST-UPDATE-LAST-CHECKED]). Guardando solo la prima, il
        # banner conterebbe come "da ricontrollare" posizioni che la coda non
        # serve più — e dichiarerebbe la cura mai finita.
        out["recheck"] = _count(conn, """
            SELECT COUNT(*)
            FROM positions p
            JOIN (SELECT position_id, MAX(total_score) AS ts
                  FROM scores GROUP BY position_id) s ON s.position_id = p.id
            WHERE p.status != 'excluded'
              AND s.ts >= ?
              AND MAX(COALESCE(p.last_checked, ''),
                      COALESCE(p.last_open_check, '')) < datetime('now', ?)
        """, (ms, f"-{days} days"))

    gm = pol["geocode_missing"]
    if economy or not gm.get("enabled", True):
        out["geocode"] = "off"
    else:
        gate, params = "", []
        if gm.get("min_score") is not None:
            gate += (" AND EXISTS (SELECT 1 FROM scores sg"
                     " WHERE sg.position_id = p.id AND sg.total_score >= ?)")
            params.append(gm["min_score"])
        if gm.get("non_remote_only", True):
            gate += " AND LOWER(COALESCE(p.work_mode, '')) != 'remote'"
        out["geocode"] = _count(conn, f"""
            SELECT COUNT(*)
            FROM positions p
            WHERE p.status != 'excluded'
              AND (p.office_lat IS NULL
                   OR p.office_geocoded IS NULL OR p.office_geocoded = 0)
              {gate}
        """, tuple(params))

    lg = pol["logo"]
    if economy or not lg.get("enabled", True):
        out["logo"] = "off"
    else:
        gate, params = "", []
        if lg.get("min_score") is not None:
            gate += ("""
              AND EXISTS (SELECT 1 FROM positions p2
                          JOIN scores s2 ON s2.position_id = p2.id
                          WHERE p2.company_id = c.id
                            AND p2.status != 'excluded'
                            AND s2.total_score >= ?)""")
            params.append(lg["min_score"])
        out["logo"] = _count(conn, f"""
            SELECT COUNT(DISTINCT c.id)
            FROM companies c
            JOIN positions p ON p.company_id = c.id AND p.status != 'excluded'
            WHERE (c.logo_fetched IS NULL OR c.logo_fetched = 0)
              {gate}
        """, tuple(params))

    # Le scadute non passano dalla policy: sono l'ordine
    # `discard_expired_rotating`, sempre parte della cura.
    out["scadute"] = _count(conn, """
        SELECT COUNT(*)
        FROM positions p
        WHERE p.status != 'excluded'
          AND p.expires_at IS NOT NULL
          AND p.expires_at < datetime('now')
    """)
    return out


def harvest_backlog(orders: Optional[dict] = None):
    """`(posizioni pronte per un CV, soglia)`. Il conteggio è None se non
    ottenibile — jobs.db illeggibile o schema vecchio — e in quel caso non si
    deduce niente: né che il raccolto sia finito, né che sia pieno.

    Sta qui e non dentro `exit_status` perché ha DUE lettori: la condizione di
    uscita della modalità `harvest` e il consiglio di `burn_mode` del bridge
    ([BURN-MODE-ADVISES-THE-WRONG-LEVER]), che deve sapere se esiste un
    raccolto da proporre prima di suggerire di spendere. Una terza copia di
    questa SQL era il modo più rapido per farle divergere.

    Gli stessi predicati di `next-for-harvest` in db_query.py — la coda è la
    fonte di verità e la stima deve contare le SUE righe, non un soprainsieme.
    Senza `status='scored'` finivano nel conto anche le `ready` (122 su una VPS
    reale) e le posizioni chiuse o scadute: il banner non avrebbe mai
    dichiarato un falso «finito» — sovrastimare è conservativo — ma il numero
    mostrato al Capitano era di un'altra coda. Se quei predicati cambiano di
    là, vanno cambiati qui: la duplicazione è voluta (il banner non importa
    db_query) ma non è libera.
    """
    orders = orders or {}
    thr = orders.get("cv_min_score")
    if not isinstance(thr, (int, float)) or isinstance(thr, bool):
        thr = HARVEST_DEFAULT_CV_MIN_SCORE
    conn = _db_ro_conn()
    if conn is None:
        return None, thr
    try:
        n = _count(conn, """
            SELECT COUNT(*)
            FROM positions p
            JOIN (SELECT position_id, MAX(total_score) AS ts
                  FROM scores GROUP BY position_id) s
              ON s.position_id = p.id
            LEFT JOIN applications a ON a.position_id = p.id
            WHERE a.id IS NULL
              AND p.status = 'scored'
              AND s.ts >= ?
              AND COALESCE(p.is_open, 1) != 0
              AND (p.expires_at IS NULL OR p.expires_at >= date('now'))
        """, (thr,))
    finally:
        try:
            conn.close()
        except sqlite3.Error:
            pass
    return n, thr


def exit_status(mode: str, orders: Optional[dict] = None,
                deadline=None, now: Optional[datetime] = None) -> dict:
    """La condizione di uscita della modalità, valutata ADESSO.

    Ritorna `{"kind", "detail"}` con kind ∈ {done, pending, continuous,
    unavailable}. `done` viene dichiarato SOLO su un conteggio riuscito e
    a zero: qualunque guasto degrada a `unavailable`, mai a un falso finito.

    `deadline` (da `mode_until`) è una condizione di uscita che vale per
    QUALUNQUE modalità e non dipende dal lavoro residuo: quando c'è, la
    modalità finisce lì anche se il suo lavoro non è esaurito.
    """
    orders = orders or {}

    if deadline is not None and mode != MODE_UNKNOWN:
        left = _deadline_remaining(deadline, now)
        return {"kind": EXIT_PENDING,
                "detail": "expires on its own at %s (%s left) and falls back "
                          "to `search`; until then the mode's own exit "
                          "condition also applies"
                          % (deadline.isoformat(timespec="minutes"),
                             left or "?")}

    if mode == MODE_SEARCH:
        return {"kind": EXIT_CONTINUOUS,
                "detail": "continuous mode; it does not end on its own — "
                          "C-25 governs surplus"}
    if mode == MODE_SAVING:
        return {"kind": EXIT_CONTINUOUS,
                "detail": "lasts until the user removes it; if budget "
                          "remains, REPORT IT (C-25), do not spend it. "
                          "No `mode_until` is set: the weekly budget is a "
                          "WINDOW, not a balance — whatever is unspent at the "
                          "reset is destroyed, so a saving left by inertia "
                          "discards the cycle. Tell the user they can give it "
                          "an end date"}
    if mode == MODE_CALIBRATION:
        return {"kind": EXIT_UNAVAILABLE,
                "detail": "cannot be evaluated here (feedback lives in the "
                          "cloud): YOU declare completion after reading "
                          "recent feedback and updating priority "
                          "(`feedback-query`)"}

    if mode == MODE_HARVEST:
        n, thr = harvest_backlog(orders)
        if n is None:
            return {"kind": EXIT_UNAVAILABLE,
                    "detail": "count unavailable (jobs.db unreadable, or an "
                              "older schema) — DO NOT infer that harvest is "
                              "finished: check with db_query"}
        if n == 0:
            return {"kind": EXIT_DONE,
                    "detail": "0 live positions with score ≥ %s without a "
                              "CV: HARVEST COMPLETE" % int(thr)}
        return {"kind": EXIT_PENDING,
                "detail": "%d live positions with score ≥ %s remain "
                          "without a CV (read-only estimate)" % (n, int(thr))}

    if mode == MODE_CARE:
        conn = _db_ro_conn()
        if conn is None:
            return {"kind": EXIT_UNAVAILABLE,
                    "detail": "jobs.db is unreadable — DO NOT infer that "
                              "care queues are empty: check with db_query"}
        try:
            counts = _care_queue_counts(conn)
        finally:
            try:
                conn.close()
            except sqlite3.Error:
                pass
        broken = sorted(k for k, v in counts.items() if v is None)
        if broken:
            broken_display = ["expired" if k == "scadute" else k
                              for k in broken]
            return {"kind": EXIT_UNAVAILABLE,
                    "detail": "queues could not be counted (%s) — DO NOT "
                              "infer that they are empty: check with db_query"
                              % ", ".join(broken_display)}
        shown = ", ".join(
            "%s=%s" % ("expired" if k == "scadute" else k,
                        "OFF by policy" if v == "off" else v)
            for k, v in counts.items())
        exhausted = all(v == "off" or v == 0 for v in counts.values())
        if exhausted:
            return {"kind": EXIT_DONE,
                    "detail": "care queues exhausted (%s): CARE COMPLETE "
                              "for now (the 14-day cadence makes them due "
                              "again)" % shown}
        return {"kind": EXIT_PENDING,
                "detail": "remaining work (read-only estimate): %s" % shown}

    # Modalità fuori enum o illeggibile: nessuna valutazione possibile.
    return {"kind": EXIT_UNAVAILABLE,
            "detail": "mode cannot be evaluated: open the file and the "
                      "`team-modes` skill"}


# ── Composizione ──────────────────────────────────────────────────────────

def _fmt_value(value) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (list, tuple)):
        text = ", ".join(str(v) for v in value)
    elif isinstance(value, dict):
        text = json.dumps(value, ensure_ascii=False)
    else:
        text = str(value)
    text = " ".join(text.split())
    if len(text) > MAX_ORDER_VALUE:
        text = text[:MAX_ORDER_VALUE - 1].rstrip() + "…"
    return text


def _order_line(key: str, value) -> str:
    """Una riga per ordine. Le chiavi note di C-18 portano la loro conseguenza;
    le altre si rendono in modo generico — il file lo scrivono anche a mano
    (`search_priority`, priorità, esclusioni), e una chiave che non conosciamo
    resta un ordine dell'utente da riferire, non da nascondere."""
    v = _fmt_value(value)
    if key == "stop_search":
        return ("stop_search: true — NO Scouts and no new positions: the "
                "`new` queue stays empty BY DESIGN (C-05/C-05c suspended)"
                if value is True else
                f"stop_search: {v} — sourcing is allowed ONLY with remaining "
                f"budget; care remains the priority")
    if key == "discard_expired_rotating":
        return ("discard_expired_rotating: true — rotate through expired "
                "positions, recheck and exclude them "
                "(recheck-liveness → [SCADUTO])"
                if value is True else
                f"discard_expired_rotating: {v} — do not exclude positions "
                f"as expired without an order")
    if key == "cv_min_score":
        return f"cv_min_score: {v} — write a CV only for positions with score ≥ {v}"
    if key == "pre_check_liveness_for_cv":
        return ("pre_check_liveness_for_cv: true — before writing a CV, "
                "verify that the position is still live"
                if value is True else
                f"pre_check_liveness_for_cv: {v}")
    return f"{key}: {v}"


def snapshot(now: Optional[datetime] = None) -> dict:
    """I fatti, letti da disco adesso. `now` è accettato per simmetria con le
    altre skill (e per i test) ma la modalità non scade col tempo."""
    m = read_maintenance()
    d = read_directives()
    expired = False
    orders = m["orders"]
    if m["exists"] and not m["readable"]:
        mode, mode_raw = MODE_UNKNOWN, None
    else:
        # Canonicalizza gli alias legacy (`normal`→search, `maintenance`→care)
        # tenendo il valore GREZZO: il banner lo mostra, così un file di
        # produzione con `maintenance` resta riconoscibile.
        mode_raw = m["mode"] if m["exists"] else None
        mode = LEGACY_MODES.get(m["mode"], m["mode"])
        if _deadline_expired(m["mode_until"], now):
            # La modalità è FINITA: torna il default. Con lei scadono i suoi
            # `orders` — «saving fino a venerdì» è un ordine solo, e lasciare
            # in piedi `stop_search: true` significherebbe tornare a `search`
            # senza cercare, cioè non tornare affatto.
            mode, orders, expired = MODE_SEARCH, {}, True
    conflicts = resolve_user_conflicts(m, d["rows"], mode)
    return {
        "mode": mode,
        "mode_raw": mode_raw,
        "mode_until": (m["mode_until"].isoformat() if m["mode_until"]
                       else None),
        "mode_until_raw": m["mode_until_raw"],
        "mode_expired": expired,
        "exit": exit_status(mode, orders,
                            deadline=None if expired else m["mode_until"],
                            now=now),
        "since": m["since"],
        "maintenance_exists": m["exists"],
        "maintenance_readable": m["readable"],
        "orders": orders,
        "directives": d["rows"],
        "directives_total": d["total"],
        "directives_readable": d["readable"],
        "flags": read_flags(),
        "read_at": (now or datetime.now(timezone.utc)).isoformat(
            timespec="seconds"),
        "conflicts": conflicts,
    }


def resolve_user_conflicts(maintenance: dict, directives: list, mode: str) -> list:
    """Return timestamp-ordered incompatible user choices, fail-closed on ties/nulls."""
    if mode in (MODE_SEARCH, MODE_UNKNOWN) or not maintenance.get("since"):
        return []
    mode_words = {
        MODE_HARVEST: ("harvest", "cv", "resume"),
        MODE_CARE: ("care", "maintenance", "recheck"),
        MODE_CALIBRATION: ("calibration", "feedback"),
        MODE_SAVING: ("saving", "spend", "autonomous"),
    }.get(mode, ())
    conflicts = []
    for row in directives:
        body = str(row.get("body") or "").lower()
        if not mode_words or not any(w in body for w in mode_words):
            continue
        # Without a reliable timestamp, do not silently choose a winner.
        created = row.get("created_at")
        if not created:
            conflicts.append({"directive_id": row.get("id"), "winner": "unknown", "notify": True})
            continue
        try:
            parsed = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            dt = parsed.timestamp()
            mt = datetime.strptime(maintenance["since"], "%Y-%m-%d %H:%M UTC").replace(tzinfo=timezone.utc).timestamp()
        except (ValueError, TypeError):
            conflicts.append({"directive_id": row.get("id"), "winner": "unknown", "notify": True}); continue
        if dt == mt:
            conflicts.append({"directive_id": row.get("id"), "winner": "unknown", "notify": True})
        else:
            conflicts.append({"directive_id": row.get("id"), "winner": "directive" if dt > mt else "mode", "notify": True})
    return conflicts


def has_standing_orders(snap: Optional[dict] = None) -> bool:
    """True se c'è un ordine dell'utente IN VIGORE da riferire.

    Cioè: modalità diversa da `search` (il default), un file presente con
    `orders` (anche a modalità search: sono comunque ordini scritti), un file
    illeggibile che va guardato, oppure almeno una direttiva in bacheca. I
    freni NON contano: sono stato dell'automazione, non un ordine, e chi li
    scrive silenzia già i bridge da sé.
    """
    s = snap if snap is not None else snapshot()
    if s["mode"] != MODE_SEARCH:
        return True
    if s["maintenance_exists"] and s.get("orders"):
        return True
    return bool(s["directives"]) or s["directives_total"] > 0


def sourcing_stopped(snap: Optional[dict] = None) -> bool:
    """True quando il file su disco VIETA il sourcing nuovo.

    Serve a chi consegna ORDINI deterministici: `heartbeat-bridge.py` ordina lo
    spawn di uno Scout quando nessuno è attivo (C-05), ma in manutenzione una
    coda `new` vuota è lo stato *voluto* e C-18 sospende esattamente quella
    regola. Senza questo, il bridge contraddirebbe nello stesso messaggio la
    sezione che gli sta in coda.

    Default `stop_search=True` a modalità dichiarata ma senza `orders`: è lo
    stesso default con cui il file viene letto dalla Console del Coordinatore
    (`vps_backend.gd`), e la direzione sicura è non ordinare spesa nuova.
    Vale per TUTTE le modalità tranne `search` (l'unica il cui senso è il
    sourcing): harvest/care/calibration/saving lo spengono per contratto, e
    un valore fuori enum è un ordine che non capiamo — non si ordina spesa
    al buio. Un file illeggibile conta come vieto: potrebbe dirlo, e non lo
    sappiamo.
    """
    s = snap if snap is not None else snapshot()
    if s["mode"] == MODE_UNKNOWN:
        return True
    if s["mode"] == MODE_SEARCH:
        return bool((s.get("orders") or {}).get("stop_search", False))
    return bool((s.get("orders") or {}).get("stop_search", True))


def _lines(snap: dict) -> list:
    out = [HEADER]
    mode = snap["mode"]
    raw = snap.get("mode_raw")
    since = f" (since {snap['since']})" if snap["since"] else ""
    legacy = (f' [in file: "{raw}", legacy value]'
              if raw and raw != mode else "")

    if snap.get("mode_expired"):
        # La modalità è finita da sé. Il file dice ancora la sua: dirlo qui
        # evita che il Capitano lo apra, legga `saving` e concluda che il
        # banner sbaglia.
        out.append(
            "MODE: search — the previous mode (`%s`) EXPIRED at %s "
            "(`mode_until`): it ended on its own and its `orders` ended with "
            "it. The file still says `%s` — the deadline wins. If the user "
            "wants it back, they set it again."
            % (raw or "?", snap.get("mode_until") or "?", raw or "?"))
    elif mode == MODE_UNKNOWN:
        out.append(
            "MODE: unknown — `profile/capitano-maintenance.json` exists but "
            "is NOT readable%s: treat it as an ACTIVE ORDER and open the file "
            "before making any sourcing decision."
            % (f" (written {snap['since']})" if snap["since"] else ""))
    elif mode == MODE_SEARCH and not snap["maintenance_exists"]:
        out.append(
            "MODE: search — no `profile/capitano-maintenance.json`: this is "
            "the default.")
    elif mode in MODE_LABELS:
        head = f"MODE: {mode} ({MODE_LABELS[mode]}){legacy}{since}"
        if snap.get("orders"):
            head += " — orders from `profile/capitano-maintenance.json`:"
        out.append(head)
    else:
        # Valore fuori enum: resta un ordine dell'utente da riferire, non da
        # normalizzare via — ma senza scheda non si ordina nulla al buio.
        out.append(
            "MODE: %s%s — value OUTSIDE the enum "
            "(search|harvest|care|calibration|saving): treat it as an ACTIVE "
            "ORDER (sourcing stopped) and open the file before deciding."
            % (mode, since))

    orders = snap.get("orders") or {}
    if orders:
        # Le chiavi note di C-18 in ordine fisso, poi le altre in ordine
        # alfabetico: la sezione deve leggersi uguale a ogni battito.
        known = ("stop_search", "discard_expired_rotating", "cv_min_score",
                 "pre_check_liveness_for_cv")
        keys = [k for k in known if k in orders]
        keys += sorted(k for k in orders if k not in known)
        for k in keys[:MAX_ORDER_LINES]:
            out.append("- " + _order_line(k, orders[k]))
        if len(keys) > MAX_ORDER_LINES:
            out.append("- (+%d orders in the file — read it)"
                       % (len(keys) - MAX_ORDER_LINES))
    elif mode not in (MODE_SEARCH, MODE_UNKNOWN):
        out.append("- (no `orders` in the file: mode declared without "
                   "details → `stop_search` defaults to TRUE, as read by the "
                   "Coordinator Console. Open the file.)")

    # La scadenza, quando c'è: è la condizione di uscita che non dipende dal
    # lavoro residuo ([SAVING-MODE-HAS-NO-DEADLINE]).
    if not snap.get("mode_expired"):
        until_raw = snap.get("mode_until_raw")
        until = snap.get("mode_until")
        if until:
            out.append("- ENDS: `mode_until` = %s → then it falls back to "
                       "`search` on its own, orders included" % until)
        elif until_raw:
            out.append("- ENDS: `mode_until` = %r is NOT a readable date "
                       "(ISO 8601 expected): the mode does NOT expire and "
                       "stays in force. Tell the user." % until_raw)

    # La SPECIFICA della modalità (le 4 dichiarazioni), non solo il nome: è
    # il requisito del contratto modalità 2026-08-03 — il Capitano che riceve
    # il battito deve sapere COSA implica, non solo come si chiama.
    spec = MODE_SPECS.get(mode)
    if spec:
        out.append("- ACTIVE QUEUES: " + spec["code"])
        out.append("- SUSPENDED: " + spec["sospeso"])
        out.append("- BUDGET: " + spec["budget"])
        ex = snap.get("exit") or {}
        kind, detail = ex.get("kind"), ex.get("detail", "")
        if kind == EXIT_DONE:
            out.append("- EXIT: WORK EXHAUSTED — %s. Do not change mode on "
                       "your own: REPORT IT to the user (silence is not "
                       "allowed; C-25 governs surplus)." % detail)
        elif kind == EXIT_PENDING:
            out.append("- EXIT: %s. NOW: %s."
                       % (spec["uscita"], detail))
        elif kind == EXIT_CONTINUOUS:
            out.append("- EXIT: %s." % detail)
        else:
            out.append("- EXIT: %s. NOW: UNAVAILABLE — %s."
                       % (spec["uscita"], detail))
    if mode != MODE_SEARCH or snap["maintenance_exists"]:
        out.append("Do not remember what this implies? Read the `team-modes` "
                   "skill BEFORE deciding.")

    if not snap["directives_readable"]:
        out.append("ACTIVE DIRECTIVES: unreadable (`team_directives` board "
                   "unreachable) — DO NOT infer that there are none")
    elif not snap["directives"]:
        out.append("ACTIVE DIRECTIVES: none")
    else:
        shown = "; ".join("#%s [%s] %s" % (d["id"], d["kind"], d["body"])
                          for d in snap["directives"])
        extra = snap["directives_total"] - len(snap["directives"])
        out.append("ACTIVE DIRECTIVES (%d): %s%s"
                   % (snap["directives_total"], shown,
                      f"; (+{extra} on the board)" if extra > 0 else ""))

    for conflict in snap.get("conflicts", []):
        winner = conflict.get("winner")
        if winner == "unknown":
            out.append("DIRECTIVE/MODE CONFLICT: timestamp missing or tied — fail-closed; ask the user which choice governs.")
        elif winner == "directive":
            out.append("DIRECTIVE/MODE CONFLICT: the newer user directive governs and supersedes the mode; ask whether to archive the older mode choice.")
        else:
            out.append("DIRECTIVE/MODE CONFLICT: the newer user mode governs and supersedes the directive; ask whether to archive the older directive.")

    flags = snap.get("flags") or []
    if flags:
        out.append("ACTIVE BRAKES: "
                   + "; ".join("%s (%s)" % (f["name"], f["why"]) for f in flags))

    out.append(FOOTER)
    return out


def banner(now: Optional[datetime] = None, multiline: bool = False,
           snap: Optional[dict] = None) -> str:
    """La sezione `[MODALITÀ CORRENTE]`. **Mai** vuota, in nessun caso."""
    s = snap if snap is not None else snapshot(now)
    lines = _lines(s)
    if multiline:
        return "\n".join(lines)
    # Su una riga il rientro non ha senso: il separatore fa già il lavoro del
    # trattino, e "· - stop_search" si legge peggio di "· stop_search".
    return JOIN.join(l[2:] if l.startswith("- ") else l for l in lines)


def line(now: Optional[datetime] = None) -> str:
    """La sezione in UNA riga, pronta per `jht-tmux-send`."""
    return banner(now, multiline=False)


def main(argv: list) -> int:
    ap = argparse.ArgumentParser(
        prog="mode_banner",
        description="Current team mode, read from disk (never from cache)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("line", help="one line (for tmux)")
    sub.add_parser("show", help="readable multiline output")
    sub.add_parser("json", help="raw facts")
    args = ap.parse_args(argv)

    snap = snapshot()
    if args.cmd == "json":
        print(json.dumps(snap, ensure_ascii=False))
    elif args.cmd == "show":
        print(banner(multiline=True, snap=snap))
    else:
        print(banner(multiline=False, snap=snap))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
