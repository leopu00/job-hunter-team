#!/usr/bin/env python3
"""Query position_feedback (loop user→agenti).

Reads like/dislike/hide/star feedback from the cloud per position or as
sanitized aggregate themes. The Scorer uses only themes from OTHER positions
as contextual preference evidence for future scoring, explicitly excluding
the position being evaluated; feedback never rewrites that position's score,
status, or notes. The Scout may consult the signal for source prioritization.

Reads cloud config from $JHT_HOME/cloud.json (same place as the daemon
and pollers). If cloud is disabled OR the endpoint is unreachable,
returns a neutral "no signal" payload (ok=true, latest_action=null)
so the caller can continue without feedback — agents must never
hard-fail on missing cloud signal.

Output (single JSON line on stdout, exit 0 on ok=true, exit 1 on
ok=false / unexpected error). Schema esteso (mig 028, 2026-05-31):

  {"ok": true, "legacy_id": "42",
   "latest_action": "dislike",
   "latest_direction": "less_like_this",
   "count": 2,
   "actions": [
     {"action": "dislike", "created_at": "...", "reason": "too_senior",
      "score": 2, "direction": "less_like_this"},
     {"action": "like", "created_at": "...", "reason": null,
      "score": null, "direction": null}
   ]}
  {"ok": true, "legacy_id": "99", "latest_action": null,
   "latest_direction": null, "count": 0, "actions": []}
  {"ok": true, "legacy_id": "...", "latest_action": null,
   "latest_direction": null, "note": "no-signal:cloud-disabled"}

Campi opzionali (NULL quando l'utente non li valorizza): `reason` (un
codice del vocabolario chiuso `shared/feedback-reasons.json`), `score`
(intero 1-5), `direction` ('more_like_this' | 'less_like_this').

JHT-T05: il TESTO che l'utente scrive (la nota, e il vecchio `comment`) non
passa da qui, in nessuna delle due corsie (locale e cloud): resta all'utente
e non arriva a nessun agente.

`latest_direction` è il valore più recente di `direction` non-NULL nella
storia della posizione, anche se non è l'ultima azione. Lo Scout lo
consulta per decidere se replicare o evitare il pattern (stessa company,
stesso role_family) in future ricerche.

Modalità in blocco (2026-07-28), per il Mentor:

  recent  — la lista degli eventi di feedback su TUTTE le posizioni in una
            finestra temporale (una sola chiamata HTTP invece di N).
  themes  — gli stessi eventi, contati per codice di motivo su posizioni
            distinte.

Perché esistono: il motivo è l'unico punto in cui l'utente dice *perché*.
Letti uno alla volta sono aneddoti; contati insieme sono un fatto. `themes` fa solo il conteggio — la soglia oltre la quale vale
la pena parlarne, e cosa farne, stanno nella skill `mentor-patterns`
(Pattern F). Qui non si decide niente: si legge e si somma.
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from feedback_reasons import LABELS, safe_reason


NO_SIGNAL_CLOUD_DISABLED = "no-signal:cloud-disabled"
NO_SIGNAL_MISSING_CREDENTIALS = "no-signal:missing-credentials"
NO_SIGNAL_REMOTE_UNAVAILABLE = "no-signal:remote-unavailable"
NO_SIGNAL_NO_READABLE_POSITIONS = "no-signal:no-readable-positions"
NO_SIGNAL_NOTES = frozenset({
    NO_SIGNAL_CLOUD_DISABLED,
    NO_SIGNAL_MISSING_CREDENTIALS,
    NO_SIGNAL_REMOTE_UNAVAILABLE,
    NO_SIGNAL_NO_READABLE_POSITIONS,
})


def _log_internal(kind: str, exc=None) -> None:
    """Diagnostics stay on stderr and never carry exception text/payloads."""
    suffix = f" ({type(exc).__name__})" if exc is not None else ""
    print(f"[feedback_query] {kind}{suffix}", file=sys.stderr)


def _no_signal_note(reason) -> str:
    if reason == "cloud-disabled":
        return NO_SIGNAL_CLOUD_DISABLED
    if reason == "missing-credentials":
        return NO_SIGNAL_MISSING_CREDENTIALS
    return NO_SIGNAL_REMOTE_UNAVAILABLE


def _jht_home() -> Path:
    raw = os.environ.get("JHT_HOME")
    if raw:
        return Path(raw)
    return Path.home() / ".jht"


def _load_cloud_config():
    cf = _jht_home() / "cloud.json"
    try:
        return json.loads(cf.read_text())
    except FileNotFoundError:
        return None
    except (OSError, json.JSONDecodeError) as exc:
        _log_internal("cloud-config-unreadable", exc)
        return None


def api_request(method: str, path: str, body=None, timeout: float = 10.0):
    """Una chiamata a /api col bearer token di cloud.json.

    Ritorna (ok, payload). payload è dict (JSON già interpretato) o una stringa
    che dice cosa è andato storto.

    Sta qui, e non in due copie, perché la corsia cloud di `position_feedback`
    è una sola: la lettura la usa per degradare a "nessun segnale", la
    scrittura (`feedback_record.py`) per fallire in modo dichiarato. Chi
    interpreta l'esito è il chiamante — questa funzione non decide se
    un cloud spento sia un guasto o una normalità, perché la risposta cambia
    fra le due direzioni.
    """
    cfg = _load_cloud_config()
    if not cfg or not cfg.get("enabled"):
        return False, "cloud-disabled"
    base_url = (cfg.get("base_url") or "").rstrip("/")
    token = cfg.get("token")
    if not base_url or not token:
        return False, "missing-credentials"

    headers = {"Authorization": f"Bearer {token}"}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        f"{base_url}{path}", data=data, headers=headers, method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            try:
                return True, json.loads(resp.read().decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                _log_internal("invalid-response", exc)
                return False, "invalid-response"
    except urllib.error.HTTPError as e:
        _log_internal(f"http-error:{e.code}")
        return False, "http-error"
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        _log_internal("network-error", e)
        return False, "network-error"


def _api_get(path: str, timeout: float = 10.0):
    """GET su /api con bearer token da cloud.json."""
    return api_request("GET", path, timeout=timeout)


def _local_events(legacy_id: str):
    """Gli eventi di giudizio nel jobs.db, i più recenti per primi.

    Ritorna None quando il locale non è consultabile (niente DB, tabella non
    ancora migrata): è diverso da «nessun giudizio», e chi chiama deve poter
    distinguere i due casi invece di leggere una lista vuota per entrambi.
    """
    if not str(legacy_id).lstrip("-").isdigit():
        return None
    try:
        import _db
        conn = _db.get_db()
    except Exception as exc:
        _log_internal("local-feedback-unavailable", exc)
        return None
    try:
        conn.row_factory = sqlite3.Row
        if not _db._table_exists(conn, "position_feedback"):
            return None
        rows = conn.execute(
            """SELECT action, reason, score, direction, created_at
                 FROM position_feedback
                WHERE position_id = ?
                ORDER BY id DESC""",
            (int(legacy_id),),
        ).fetchall()
        return [dict(r) for r in rows]
    except Exception as exc:
        _log_internal("local-feedback-query-failed", exc)
        return None
    finally:
        conn.close()


def check_position(legacy_id: str) -> dict:
    # Local-first (O-15): il giudizio vive nel jobs.db e il cloud è un
    # riflesso. Si interroga la rete solo quando il locale non è consultabile
    # — così a cloud spento la lettura RISPONDE invece di degradare, e non si
    # paga una chiamata HTTP per sapere una cosa che è già in casa.
    local = _local_events(legacy_id)
    if local is not None:
        return _shape_events(legacy_id, local, source="local")

    safe_id = urllib.parse.quote(str(legacy_id), safe="")
    ok, payload = _api_get(f"/api/positions/{safe_id}/feedback")
    if not ok:
        # Neutral: caller continues senza signal. Logghiamo la ragione
        # come diagnostica ma ok=True per non bloccare lo Scorer.
        return {
            "ok": True,
            "legacy_id": str(legacy_id),
            "latest_action": None,
            "latest_direction": None,
            "count": 0,
            "actions": [],
            "note": _no_signal_note(payload),
        }
    return _shape_events(legacy_id, payload.get("feedback") or [], source="cloud")


def _shape_events(legacy_id: str, feedback, source: str) -> dict:
    """Da elenco di eventi (locale o cloud) alla risposta di check_position.

    Una forma sola per le due sorgenti: se divergessero, lo Scorer leggerebbe
    due strutture diverse a seconda di dove ha trovato il dato.
    """
    # Gli eventi arrivano già dal più recente: feedback[0] è l'ultimo.
    # mig 028: comment / score / direction sono opzionali, possono essere
    # NULL su righe pre-estensione o quando l'utente non li valorizza.
    # JHT-T05: dell'evento passano solo i campi dichiarati qui, e il motivo
    # solo come codice del vocabolario. La nota e il vecchio commento dell'utente
    # non escono mai da questa funzione, qualunque cosa arrivi dalla sorgente
    # (locale o cloud): è l'unico punto da cui le due corsie diventano risposta.
    actions = [
        {
            "action": f["action"],
            "created_at": f.get("created_at"),
            "reason": safe_reason(f.get("reason")),
            "score": f.get("score"),
            "direction": f.get("direction"),
        }
        for f in feedback
    ]
    # latest_direction = il valore più recente di `direction` non-null
    # (anche se non è l'ultima azione). Utile allo Scout per pattern-matching.
    latest_direction = next(
        (a["direction"] for a in actions if a["direction"]),
        None,
    )
    return {
        "ok": True,
        "legacy_id": str(legacy_id),
        "latest_action": actions[0]["action"] if actions else None,
        "latest_direction": latest_direction,
        "count": len(actions),
        "actions": actions,
        # Da dove viene la risposta: serve a distinguere «nessun giudizio»
        # (locale consultato, vuoto) da «non l'ho potuto sapere» (cloud muto).
        "source": source,
    }


# ─────────────────────────────────────────────────────────────────────
# Lettura in blocco: gli eventi di feedback su tutte le posizioni
# ─────────────────────────────────────────────────────────────────────

DEFAULT_WINDOW_DAYS = 30
DEFAULT_EVENT_LIMIT = 500
#  Il commento arriva fino a 2000 caratteri: stampato per intero su 500
#  eventi seppellirebbe l'agente che lo legge. `recent` tronca, `--full` no.
DEFAULT_TEXT_CHARS = 300

ACTION_KINDS = ("like", "dislike", "hide", "star", "clear")


def _parse_ts(value):
    """ISO 8601 (anche con 'Z') → datetime aware. None se illeggibile."""
    if not value:
        return None
    raw = str(value).strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _normalize_row(row: dict) -> dict:
    """Riga dell'API → evento con lo stesso vocabolario di `check`."""
    return {
        "legacy_id": str(
            row.get("position_legacy_id")
            if row.get("position_legacy_id") is not None
            else row.get("legacy_id", "")
        ),
        "action": row.get("action"),
        "created_at": row.get("created_at"),
        "reason": safe_reason(row.get("reason")),
        "score": row.get("score"),
        "direction": row.get("direction"),
    }


def _sorted_desc(events):
    """Eventi dal più recente al più vecchio.

    L'endpoint ordina già DESC, ma il fallback per-posizione concatena storie
    diverse: riordinare qui rende `_latest_action_by_position` indipendente
    da chi ha prodotto la lista. Gli eventi senza timestamp leggibile
    finiscono in fondo, senza far esplodere il sort.
    """
    floor = datetime.min.replace(tzinfo=timezone.utc)
    return sorted(events, key=lambda e: _parse_ts(e.get("created_at")) or floor,
                  reverse=True)


def _within_window(events, days):
    """Filtra client-side sulla finestra: non ci si fida del solo endpoint."""
    if not days or days <= 0:
        return list(events)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    kept = []
    for e in events:
        ts = _parse_ts(e.get("created_at"))
        # Timestamp illeggibile: si tiene. Meglio un evento in più che
        # perdere silenziosamente una riga per un formato inatteso.
        if ts is None or ts >= cutoff:
            kept.append(e)
    return kept


def _latest_action_by_position(events_desc):
    """{legacy_id: azione più recente}. Serve a riconoscere i voti ritirati."""
    latest = {}
    for e in events_desc:
        lid = e.get("legacy_id")
        if lid and lid not in latest:
            latest[lid] = e.get("action")
    return latest


def fetch_events(days=DEFAULT_WINDOW_DAYS, limit=DEFAULT_EVENT_LIMIT,
                 legacy_ids=None):
    """Eventi di feedback in blocco. Ritorna (events, note).

    Due sorgenti, nello stesso ordine di preferenza:
      1. `GET /api/positions/feedback` — una chiamata, tutte le posizioni;
      2. `legacy_ids` esplicito → N chiamate a `check` (fallback usabile
         quando l'endpoint aggregato non è ancora deployato sul cloud).

    `note` non-None = nessun segnale (cloud spento, endpoint assente, rete
    giù). Non è un errore: il chiamante continua senza feedback.
    """
    if legacy_ids:
        events, failures = [], 0
        for lid in legacy_ids:
            payload = check_position(lid)
            if payload.get("note"):
                failures += 1
                continue
            for a in payload.get("actions", []):
                ev = dict(a)
                ev["legacy_id"] = str(lid)
                events.append(ev)
        if failures and failures == len(legacy_ids):
            return [], NO_SIGNAL_NO_READABLE_POSITIONS
        return _within_window(_sorted_desc(events), days), None

    q = urllib.parse.urlencode({"days": int(days), "limit": int(limit)})
    ok, payload = _api_get(f"/api/positions/feedback?{q}", timeout=20.0)
    if not ok:
        return [], _no_signal_note(payload)
    rows = payload.get("feedback") or []
    events = [_normalize_row(r) for r in rows]
    return _within_window(_sorted_desc(events), days), None


def _truncate(value, max_chars):
    if value is None or max_chars is None or max_chars <= 0:
        return value
    text = str(value)
    return text if len(text) <= max_chars else text[:max_chars] + "…"


def recent_feedback(days=DEFAULT_WINDOW_DAYS, limit=DEFAULT_EVENT_LIMIT,
                    text_chars=None, legacy_ids=None) -> dict:
    """Lista piatta degli eventi + conteggi per azione.

    `text_chars` resta nella firma per i chiamanti vecchi e non fa niente: gli
    eventi non portano più testo dell'utente, solo il codice del motivo.
    """
    events, note = fetch_events(days=days, limit=limit, legacy_ids=legacy_ids)
    by_action = Counter(e.get("action") for e in events if e.get("action"))
    with_reason = sum(1 for e in events if e.get("reason"))
    items = [dict(e) for e in events[:limit]]
    out = {
        "ok": True,
        "window_days": days,
        "count": len(events),
        "positions": len({e.get("legacy_id") for e in events if e.get("legacy_id")}),
        "with_reason": with_reason,
        "by_action": {k: by_action.get(k, 0) for k in ACTION_KINDS
                      if by_action.get(k)},
        "items": items,
    }
    if note:
        out["note"] = note
    return out


# ─────────────────────────────────────────────────────────────────────
# I motivi ricorrenti
# ─────────────────────────────────────────────────────────────────────
#
# JHT-T05: il motivo di un giudizio è un codice del vocabolario chiuso
# (`shared/feedback-reasons.json`), quindi contare non richiede più di
# interpretare testo: si contano POSIZIONI DISTINTE per codice (giudicare due
# volte lo stesso annuncio resta un'opinione sola). Il testo che l'utente
# scrive è la nota, e qui non arriva mai.
MAX_THEME_IDS = 20


def aggregate_themes(events, min_positions=3, include_cleared=False,
                     top=None) -> dict:
    """Eventi → codici di motivo ricorrenti, per posizioni distinte.

    Le posizioni il cui ultimo evento è `clear` (mig 059 — il voto è stato
    ritirato) restano fuori di default. Conta solo l'ultimo giudizio di ogni
    posizione, e una posizione compare una volta sola per codice.
    """
    events_desc = _sorted_desc(events)
    latest = _latest_action_by_position(events_desc)
    cleared = {lid for lid, act in latest.items() if act == "clear"}

    considered = [
        e for e in events_desc
        if e.get("legacy_id")
        and (include_cleared or e.get("legacy_id") not in cleared)
    ]
    # L'ultimo evento di ogni posizione: i giudizi superati non contano.
    last_of = {}
    for e in considered:
        last_of.setdefault(e["legacy_id"], e)
    # Anche se l'evento arriva da fuori `fetch_events`, il motivo passa dal
    # vocabolario: un testo libero vale `other`, mai se stesso.
    with_reason = {lid: e for lid, e in last_of.items() if safe_reason(e.get("reason"))}

    themes = {}
    for lid, e in with_reason.items():
        code = safe_reason(e["reason"])
        th = themes.setdefault(code, {"positions": set(), "actions": Counter()})
        th["positions"].add(lid)
        if e.get("action"):
            th["actions"][e["action"]] += 1

    denom = len(with_reason) or 1
    rows = []
    for code, th in themes.items():
        if len(th["positions"]) < min_positions:
            continue
        ids = sorted(th["positions"])
        rows.append({
            "key": code,
            "label": LABELS.get(code, code),
            "positions": len(th["positions"]),
            "events": len(th["positions"]),
            "share": round(len(th["positions"]) / denom, 3),
            "actions": dict(sorted(th["actions"].items())),
            "legacy_ids": ids[:MAX_THEME_IDS],
        })
    rows.sort(key=lambda r: (-r["positions"], r["key"]))
    if top:
        rows = rows[:top]

    by_action = Counter(e.get("action") for e in considered if e.get("action"))
    return {
        "events_total": len(considered),
        "events_with_reason": sum(1 for e in considered if safe_reason(e.get("reason"))),
        "positions_with_reason": len(with_reason),
        "positions_cleared": len(cleared),
        "by_action": {k: by_action.get(k, 0) for k in ACTION_KINDS
                      if by_action.get(k)},
        "min_positions": min_positions,
        "themes": rows,
    }


def themes_report(days=DEFAULT_WINDOW_DAYS, limit=DEFAULT_EVENT_LIMIT,
                  field=None, min_positions=3, include_cleared=False,
                  top=None, legacy_ids=None, exclude_legacy_ids=None) -> dict:
    events, note = fetch_events(days=days, limit=limit, legacy_ids=legacy_ids)
    excluded = {str(value) for value in (exclude_legacy_ids or [])}
    if excluded:
        events = [e for e in events if str(e.get("legacy_id")) not in excluded]
    out = {"ok": True, "window_days": days}
    if excluded:
        # Attestazione machine-readable per i chiamanti che devono dimostrare
        # che il feedback della posizione corrente non influenza se stesso.
        out["excluded_legacy_ids"] = sorted(excluded)
    out.update(aggregate_themes(
        events, min_positions=min_positions,
        include_cleared=include_cleared, top=top,
    ))
    if note:
        out["note"] = note
    return out


def main() -> None:
    p = argparse.ArgumentParser(
        description="Query cloud position_feedback (Scout/Scorer/Mentor).",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    chk = sub.add_parser(
        "check",
        help="Return the most recent action for a position (None if absent).",
    )
    chk.add_argument("legacy_id", help="positions.legacy_id (TEXT)")

    def _window_args(sp):
        sp.add_argument("--days", type=int, default=DEFAULT_WINDOW_DAYS,
                        help="Window in days (default 30, 0 = all).")
        sp.add_argument("--limit", type=int, default=DEFAULT_EVENT_LIMIT,
                        help="Maximum events read from the cloud (default 500).")
        sp.add_argument("--legacy-ids", default=None,
                        help="Fallback: comma-separated IDs, read one at a time "
                             "instead of from the aggregate endpoint.")

    rec = sub.add_parser(
        "recent",
        help="Feedback events for all positions within a window.",
    )
    _window_args(rec)
    rec.add_argument("--text-chars", type=int, default=0,
                     help="Ignored: events carry the reason code only.")

    thm = sub.add_parser(
        "themes",
        help="Recurring reason codes, counted over distinct positions.",
    )
    _window_args(thm)
    thm.add_argument("--field", choices=("reason", "comment", "both"),
                     default="both", help="Ignored: kept for older prompts.")
    thm.add_argument("--min-positions", type=int, default=3,
                     help="Discard themes below N distinct positions (default 3).")
    thm.add_argument("--top", type=int, default=None,
                     help="Keep only the top N themes.")
    thm.add_argument("--include-cleared", action="store_true",
                     help="Also count positions whose vote was cleared.")
    thm.add_argument(
        "--exclude-legacy-id",
        action="append",
        default=[],
        help="Exclude one position from the aggregate (repeatable).",
    )

    args = p.parse_args()
    ids = None
    if getattr(args, "legacy_ids", None):
        ids = [s.strip() for s in args.legacy_ids.split(",") if s.strip()]

    try:
        if args.cmd == "check":
            result = check_position(args.legacy_id)
        elif args.cmd == "recent":
            result = recent_feedback(
                days=args.days, limit=args.limit,
                text_chars=args.text_chars, legacy_ids=ids,
            )
        elif args.cmd == "themes":
            result = themes_report(
                days=args.days, limit=args.limit, field=args.field,
                min_positions=args.min_positions, top=args.top,
                include_cleared=args.include_cleared, legacy_ids=ids,
                exclude_legacy_ids=args.exclude_legacy_id,
            )
        else:
            result = {"ok": False, "error": f"unknown command: {args.cmd}"}
    except Exception as e:
        _log_internal("unexpected-error", e)
        result = {"ok": False, "error": "feedback-query-failed"}

    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
