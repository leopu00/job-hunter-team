#!/usr/bin/env python3
"""expiration_alerts — trova application READY con deadline imminente (F-4).

Bug latente: utente accumula 50 CV pronti, dimentica di applicare per
2 giorni, top opportunità scadono in silenzio. Lo script:

1. Query: `applications.status='ready'` con `positions.deadline` < NOW()+72h
2. Idempotenza: stato in `$JHT_HOME/state/expiration_alerts_sent.json`
   con set di `(application_id, deadline_iso)` già notificati — 1 alert
   per coppia (no spam giornaliero sulla stessa scadenza).
3. Stdout: 1 riga per application a rischio, formato testuale
   "[ALERT] Sisal Data Analytics (PASS 7.5) — scadenza 2026-05-19 (tra 2gg)"
   pronto per `jht-telegram-send`.

Trigger consigliato: cron 6h, oppure Mentor end-of-pass / Capitano dopo
ogni [BRIDGE TICK]. Idempotenza fa sì che chiamate troppo frequenti
non producano duplicati.

CLI:
    python3 /app/shared/skills/expiration_alerts.py          # stdout alerts
    python3 /app/shared/skills/expiration_alerts.py --quiet  # exit 0 se nessun alert
    python3 /app/shared/skills/expiration_alerts.py --reset  # reset state (dev)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _db import get_db, ensure_schema  # type: ignore


JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
STATE_DIR = JHT_HOME / "state"
STATE_FILE = STATE_DIR / "expiration_alerts_sent.json"
HORIZON_DAYS = 3  # alerta per deadline entro 3 giorni


def _load_state() -> dict:
    if not STATE_FILE.exists():
        return {"sent": []}
    try:
        with STATE_FILE.open("r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {"sent": []}


def _save_state(state: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    tmp.replace(STATE_FILE)


def _parse_deadline(deadline_str: str | None) -> date | None:
    if not deadline_str:
        return None
    try:
        return date.fromisoformat(deadline_str[:10])
    except (ValueError, TypeError):
        return None


def find_alerts(quiet: bool = False) -> int:
    today = datetime.now(timezone.utc).date()
    horizon = (today.toordinal() + HORIZON_DAYS)

    conn = get_db()
    ensure_schema(conn)

    rows = conn.execute("""
        SELECT a.id AS app_id, p.id AS pos_id, p.company, p.title,
               p.deadline, a.critic_score, a.cv_pdf_path
          FROM applications a
          JOIN positions p ON p.id = a.position_id
         WHERE a.status = 'ready'
           AND p.deadline IS NOT NULL
           AND TRIM(p.deadline) != ''
    """).fetchall()

    state = _load_state()
    already = {tuple(s) for s in state.get("sent", [])}
    new_alerts = []
    output_lines = []

    for r in rows:
        deadline = _parse_deadline(r["deadline"])
        if not deadline:
            continue
        days_left = deadline.toordinal() - today.toordinal()
        if days_left < 0 or days_left > HORIZON_DAYS:
            continue
        key = (r["app_id"], deadline.isoformat())
        if key in already:
            continue
        # Format user-facing
        score = r["critic_score"]
        score_str = f"(PASS {score:.1f})" if score is not None else "(PASS)"
        when = (
            "OGGI" if days_left == 0
            else "DOMANI" if days_left == 1
            else f"tra {days_left}gg"
        )
        line = (
            f"⏳ [ALERT scadenza] {r['company']} {r['title']} {score_str} — "
            f"scade {deadline.isoformat()} ({when}). "
            f"Spedisci candidatura o perdi l'opportunità."
        )
        output_lines.append(line)
        new_alerts.append(list(key))

    if new_alerts:
        state.setdefault("sent", []).extend(new_alerts)
        _save_state(state)

    if not quiet or output_lines:
        for line in output_lines:
            print(line)

    return 0 if output_lines else (0 if not quiet else 1)


def main(argv):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--quiet", action="store_true",
                   help="No stdout se nessun nuovo alert (exit 1).")
    p.add_argument("--reset", action="store_true",
                   help="Dev-only: cancella lo state file (rispedirà tutti i pending).")
    args = p.parse_args(argv)

    if args.reset:
        try:
            STATE_FILE.unlink()
        except FileNotFoundError:
            pass
        print(f"state reset: {STATE_FILE}")
        return 0

    return find_alerts(quiet=args.quiet)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
