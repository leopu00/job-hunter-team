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

**Mai vuota.** `banner()` ritorna sempre una sezione, anche a modalità normale
(`MODE: normal`, una riga). L'assenza della sezione deve poter significare solo
«bridge rotto» — mai «modalità normale», altrimenti si ricrea l'ambiguità
silenzio=default che è la causa dell'incidente.

**Chiude dichiarando chi vince.** L'ultima riga dice che in caso di contrasto
vince il file. Non è decorazione: dopo un refresh il Capitano ha un contesto
pulito che *contraddice* l'ordine, e deve sapere quale dei due è autorevole.

Corollario: un `capitano-maintenance.json` presente ma **illeggibile** non
diventa `normal`. Si dichiara `MODE: sconosciuto` e si tratta come un ordine
attivo — la direzione sicura è far leggere il file a un umano, non dedurre che
non ci fosse nessun ordine.

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

MODE_NORMAL = "normal"
MODE_MAINTENANCE = "maintenance"
MODE_UNKNOWN = "sconosciuto"

HEADER = "[MODALITÀ CORRENTE — iniettata dal bridge, fonte: file su disco]"
# L'ultima riga del disegno: senza di essa la sezione è un promemoria, con essa
# è un ordine di precedenza.
FOOTER = (
    "Se questa sezione contraddice il tuo contesto, VINCE QUESTA: il file su "
    "disco è la fonte di verità e il tuo contesto può essere stato azzerato da "
    "un refresh."
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
         "l'utente ha FERMATO il team"),
        ("team-standby", home / ".team-standby.flag",
         "standby a spesa zero"),
        ("daily-halt", logs / "daily-halt.flag", "cap giornaliero sforato"),
        ("daily-halt", home / ".daily-halt.flag", "cap giornaliero sforato"),
        ("weekly-halt", home / ".weekly-halt.flag", "quota settimanale esaurita"),
        ("weekly-halt", logs / "weekly-halt.flag", "quota settimanale esaurita"),
    )


# ── Lettura della modalità ────────────────────────────────────────────────

def read_maintenance() -> dict:
    """Cosa dice `capitano-maintenance.json` ADESSO.

    Ritorna sempre un dict con `{"exists", "readable", "mode", "orders",
    "since"}`. Un file presente ma rotto NON diventa `normal`: `readable` è
    False e il chiamante lo dichiara `sconosciuto`.
    """
    path = maintenance_file()
    out = {"exists": False, "readable": False, "mode": MODE_NORMAL,
           "orders": {}, "since": None, "path": str(path)}
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
    out["mode"] = mode.strip() if isinstance(mode, str) and mode.strip() else MODE_NORMAL
    orders = data.get("orders")
    out["orders"] = orders if isinstance(orders, dict) else {}
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
            "SELECT id, body, kind FROM team_directives WHERE status = 'active' "
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
    for r in rows[:max(0, limit)]:
        body = str(r["body"] or "").strip().replace("\n", " ")
        if len(body) > MAX_DIRECTIVE_BODY:
            body = body[:MAX_DIRECTIVE_BODY - 1].rstrip() + "…"
        out["rows"].append({"id": r["id"], "kind": r["kind"], "body": body})
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
            "why": "deroga di spesa dell'utente, scade fra %s min"
                   % bi.get("remaining_min"),
        })
    return out


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
        return ("stop_search: true — NIENTE Scout, nessuna offerta nuova: la "
                "coda `new` resta vuota BY DESIGN (C-05/C-05c sospese)"
                if value is True else
                f"stop_search: {v} — sourcing consentito SOLO col budget che "
                f"avanza, la manutenzione resta la priorità")
    if key == "discard_expired_rotating":
        return ("discard_expired_rotating: true — a rotazione ri-verifica le "
                "scadute ed escludile (recheck-liveness → [SCADUTO])"
                if value is True else
                f"discard_expired_rotating: {v} — non escludere per scadenza "
                f"senza un ordine")
    if key == "cv_min_score":
        return f"cv_min_score: {v} — scrivi un CV solo per posizioni con score ≥ {v}"
    if key == "pre_check_liveness_for_cv":
        return ("pre_check_liveness_for_cv: true — prima di un CV verifica che "
                "l'offerta sia ancora viva"
                if value is True else
                f"pre_check_liveness_for_cv: {v}")
    return f"{key}: {v}"


def snapshot(now: Optional[datetime] = None) -> dict:
    """I fatti, letti da disco adesso. `now` è accettato per simmetria con le
    altre skill (e per i test) ma la modalità non scade col tempo."""
    m = read_maintenance()
    d = read_directives()
    if m["exists"] and not m["readable"]:
        mode = MODE_UNKNOWN
    else:
        mode = m["mode"]
    return {
        "mode": mode,
        "since": m["since"],
        "maintenance_exists": m["exists"],
        "maintenance_readable": m["readable"],
        "orders": m["orders"],
        "directives": d["rows"],
        "directives_total": d["total"],
        "directives_readable": d["readable"],
        "flags": read_flags(),
        "read_at": (now or datetime.now(timezone.utc)).isoformat(
            timespec="seconds"),
    }


def has_standing_orders(snap: Optional[dict] = None) -> bool:
    """True se c'è un ordine dell'utente IN VIGORE da riferire.

    Cioè: modalità diversa da `normal` (manutenzione, o un file illeggibile che
    va guardato) oppure almeno una direttiva in bacheca. I freni NON contano:
    sono stato dell'automazione, non un ordine, e chi li scrive silenzia già i
    bridge da sé.
    """
    s = snap if snap is not None else snapshot()
    if s["mode"] != MODE_NORMAL:
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
    (`vps_backend.gd`), e la direzione sicura è non ordinare spesa nuova. Un
    file illeggibile conta come vieto: potrebbe dirlo, e non lo sappiamo.
    """
    s = snap if snap is not None else snapshot()
    if s["mode"] == MODE_UNKNOWN:
        return True
    if s["mode"] == MODE_NORMAL:
        return False
    return bool((s.get("orders") or {}).get("stop_search", True))


def _lines(snap: dict) -> list:
    out = [HEADER]

    if snap["mode"] == MODE_UNKNOWN:
        out.append(
            "MODE: sconosciuto — `profile/capitano-maintenance.json` esiste ma "
            "NON è leggibile%s: trattalo come un ORDINE ATTIVO e apri il file "
            "prima di decidere qualunque cosa sul sourcing."
            % (f" (scritto {snap['since']})" if snap["since"] else ""))
    elif snap["mode"] == MODE_NORMAL:
        out.append(
            "MODE: normal — nessun `profile/capitano-maintenance.json`: "
            "sourcing attivo, recheck on-demand (C-13).")
    else:
        out.append("MODE: %s%s — ordini da `profile/capitano-maintenance.json`:"
                   % (snap["mode"],
                      f" (dal {snap['since']})" if snap["since"] else ""))

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
            out.append("- (+%d ordini nel file — leggilo)"
                       % (len(keys) - MAX_ORDER_LINES))
    elif snap["mode"] not in (MODE_NORMAL, MODE_UNKNOWN):
        out.append("- (nessun `orders` nel file: modalità dichiarata senza "
                   "dettagli → `stop_search` vale TRUE per default, come lo "
                   "legge la Console del Coordinatore. Apri il file.)")

    if not snap["directives_readable"]:
        out.append("DIRETTIVE ATTIVE: non leggibili (bacheca `team_directives` "
                   "non raggiungibile) — NON dedurre che non ce ne siano")
    elif not snap["directives"]:
        out.append("DIRETTIVE ATTIVE: nessuna")
    else:
        shown = "; ".join("#%s [%s] %s" % (d["id"], d["kind"], d["body"])
                          for d in snap["directives"])
        extra = snap["directives_total"] - len(snap["directives"])
        out.append("DIRETTIVE ATTIVE (%d): %s%s"
                   % (snap["directives_total"], shown,
                      f"; (+{extra} in bacheca)" if extra > 0 else ""))

    flags = snap.get("flags") or []
    if flags:
        out.append("FRENI ATTIVI: "
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
        description="Modalità corrente del team, letta da disco (mai da cache)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("line", help="una riga (per tmux)")
    sub.add_parser("show", help="multi-riga leggibile")
    sub.add_parser("json", help="i fatti grezzi")
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
