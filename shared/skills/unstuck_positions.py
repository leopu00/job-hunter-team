#!/usr/bin/env python3
"""Reset positions stuck in `writing` o `checked` da troppo tempo.

Origin: docs/internal/postmortems/2026-05-21-vps1-run-postmortem.md anomalia #4:
> 2 position in `writing` ancora bloccate al momento del HALT
> (kill Scrittore-3 stamattina). Saranno state lasciate a metà —
> controllare al resume per cleanup.

Quando uno Scrittore viene killato mid-write (HALT-WEEKLY, crash, kill
manuale), la position resta `status='writing'` per sempre. Al resume:

- Nessuno Scrittore la rivendica (`next-for-scrittore` cerca `status='scored'`).
- La position e' orfana, esce dai conteggi Capitano.

Questo skill:
1. Trova positions in `status='writing'` con `updated_at` piu' vecchio di
   --stale-hours (default 2h).
2. Le resetta a `status='scored'` con nota in `notes` per audit trail.
3. Idempotente: se non c'e' nessuna stuck, exit code 0 senza modifiche.

`status='checked'` NON è un lavoro lasciato a metà: è la coda dello Scorer
(`next-for-scorer` = checked senza punteggio), e una posizione ci aspetta
finché lo Scorer non la prende, anche per ore se è in pausa. Fino al
2026-09-27 `--include-checked` la rimandava a `new`, cioè all'Analista, che la
rianalizzava da capo: a ogni avvio del container. Peggio con una posizione
`checked` che un punteggio lo ha già (#60 su una VPS, punteggio di luglio):
lo Scorer non la prende mai, e il reset la rimandava all'Analista cinque volte
dal 18/08. Ora `--include-checked`:
- lascia dove sta la `checked` SENZA punteggio: è in coda allo Scorer;
- porta a `scored` la `checked` CON punteggio: è già valutata, niente da rifare.
Nessuna posizione torna mai a `new`: una posizione analizzata non si rianalizza.

Ogni cambio di stato scrive la sua riga in `position_state_transitions`
(by_agent='unstuck'), come ogni altro cambio di stato del team: prima il
reset si vedeva solo nelle note e nel log di pid1.

Uso:
    python3 unstuck_positions.py             # dry-run default 2h
    python3 unstuck_positions.py --apply     # actually reset
    python3 unstuck_positions.py --apply --stale-hours 1
    python3 unstuck_positions.py --apply --include-checked

Integrazione boot (suggerita, pid1.js dopo runMigrate):
    python3 /app/shared/skills/unstuck_positions.py --apply

Se invocato senza --apply, lista solo (utile per audit pre-HALT).
"""

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))
from _db import get_db, ensure_schema


def find_stuck(conn, status, stale_hours):
    """Ritorna lista di (id, title, company, updated_at) stuck in `status`.

    Per `checked` solo quelle che un punteggio lo hanno già: le altre sono la
    coda dello Scorer, non righe bloccate."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=stale_hours)).isoformat()
    # datetime() normalizza i due formati che convivono in updated_at:
    # ISO con 'T' (INSERT espliciti) e 'YYYY-MM-DD HH:MM:SS' col trigger
    # positions_touch_updated_at. Il confronto lessicografico puro vedeva
    # ogni riga formato-spazio con la stessa data del cutoff come stuck
    # (spazio < 'T'), resettando anche righe fresche di minuti.
    cursor = conn.execute(
        """
        SELECT id, title, company, status, updated_at
        FROM positions
        WHERE status = ?
          AND datetime(updated_at) < datetime(?)
          AND (? <> 'checked'
               OR EXISTS (SELECT 1 FROM scores s WHERE s.position_id = positions.id))
        ORDER BY updated_at ASC
        """,
        (status, cutoff, status)
    )
    return cursor.fetchall()


def reset_position(conn, row_id, current_status, audit_note):
    """Riporta una position allo stato giusto, con transizione e audit in notes."""
    # writing → scored: lo Scrittore è morto a metà, lo Scorer aveva già fatto
    #   il suo lavoro; la posizione torna nella coda degli Scrittori.
    # checked (con punteggio) → scored: già valutata, il punteggio c'è.
    new_status = 'scored'

    # Concatena la audit note alle notes esistenti senza distruggere
    # contenuto precedente. Format: "<existing>\n[unstuck YYYY-MM-DD]: <note>"
    existing_notes = conn.execute(
        "SELECT COALESCE(notes, '') FROM positions WHERE id = ?",
        (row_id,)
    ).fetchone()[0]
    timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    new_notes = (
        (existing_notes + '\n' if existing_notes else '')
        + f'[unstuck {timestamp}]: {audit_note} (was {current_status})'
    )

    conn.execute(
        """
        UPDATE positions
        SET status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (new_status, new_notes, row_id)
    )
    conn.execute(
        "INSERT INTO position_state_transitions "
        "(position_id, from_state, to_state, by_agent, notes) "
        "VALUES (?, ?, ?, 'unstuck', ?)",
        (row_id, current_status, new_status, audit_note)
    )
    return new_status


def main(argv=None):
    parser = argparse.ArgumentParser(description='Reset positions stuck in writing/checked')
    parser.add_argument(
        '--stale-hours', type=float, default=2.0,
        help='Hours of inactivity before a row is considered stuck (default: 2.0)'
    )
    parser.add_argument(
        '--apply', action='store_true',
        help='Apply the reset; without this flag, only list rows (dry run).'
    )
    parser.add_argument(
        '--include-checked', action='store_true',
        help='Also move status=checked positions that already have a score to scored '
             '(checked without a score is the Scorer queue and is left alone).'
    )
    parser.add_argument(
        '--audit-note',
        default='automatic reset at boot (Scrittore/Scorer terminated mid-run)',
        help='Text appended to positions.notes for the audit trail.'
    )
    args = parser.parse_args(argv)

    conn = get_db()
    ensure_schema(conn)

    statuses_to_check = ['writing']
    if args.include_checked:
        statuses_to_check.append('checked')

    total_found = 0
    total_reset = 0
    for status in statuses_to_check:
        stuck = find_stuck(conn, status, args.stale_hours)
        if not stuck:
            continue
        total_found += len(stuck)
        print(f'[unstuck] {len(stuck)} position(s) stuck in status={status}'
              f' for > {args.stale_hours}h:', file=sys.stderr)
        for row in stuck:
            print(f'  - #{row["id"]} "{row["title"]}" @ {row["company"]}'
                  f' (updated_at={row["updated_at"]})', file=sys.stderr)
            if args.apply:
                new_status = reset_position(conn, row['id'], status, args.audit_note)
                print(f'    -> reset to status={new_status}', file=sys.stderr)
                total_reset += 1

    if args.apply:
        conn.commit()
        print(f'[unstuck] committed {total_reset} reset(s)', file=sys.stderr)
    else:
        if total_found > 0:
            print(f'[unstuck] dry-run: {total_found} stuck row(s). '
                  f'Re-run with --apply to reset.', file=sys.stderr)
        else:
            print(f'[unstuck] no stuck positions (threshold {args.stale_hours}h).',
                  file=sys.stderr)

    conn.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
