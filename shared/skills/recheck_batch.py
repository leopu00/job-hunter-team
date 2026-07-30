#!/usr/bin/env python3
"""recheck_batch.py — pre-filtro MECCANICO del recheck cadenzato (MODALITÀ CURA).

Il recheck di una posizione già analizzata è una frazione del lavoro di una
posizione nuova, ma misurato sul campo costava 78-86kT a posizione: un turno
LLM intero (contesto + improvvisazione) per un lavoro che è al 90% meccanico.
Questo script fa quella parte meccanica IN UN SOLO COMANDO su un batch bounded
della coda `next-for-recheck-due` (stessa query, stessi gate della policy,
stesso ordine score DESC), così l'Analista spende il suo giudizio SOLO sui
casi ambigui.

Cosa fa DA SOLO (meccanico, sicuro):
  - `OPEN` verificato (tiered: curl → browser, mai falso-aperto, vedi
    recheck_liveness.py) → aggiorna `last_checked` (+ `is_open=1`): la
    posizione è "fresca" ed esce dalla coda per la cadenza (default 14gg).

Cosa NON fa MAI (requisito utente 2026-07-30 — il giudizio resta all'Analista):
  - NON esclude e NON cambia `status`. `CLOSED` e `OPEN_UNVERIFIED` restano
    in coda e finiscono nel report CON L'EVIDENZA: è l'Analista che verifica
    (one-shot) e decide l'esclusione (`[SCADUTO]`) o il da farsi. Uno script
    statico può sbagliare e buttare una posizione ancora viva; un Analista
    risponde del verdetto.

Uso:
  python3 recheck_batch.py                  # batch dalla coda (default 10)
  python3 recheck_batch.py --limit 5
  python3 recheck_batch.py --ids 12 34 56   # posizioni specifiche
  python3 recheck_batch.py --dry-run        # nessuna scrittura, solo report
  python3 recheck_batch.py --json           # report macchina (una riga JSON)

Exit: 0 ok (anche con casi da giudicare) · 1 coda OFF per policy · 3 errore-uso.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from _db import get_db, ensure_schema  # noqa: E402
from db_query import recheck_due_rows  # noqa: E402
from recheck_liveness import recheck  # noqa: E402


def _rows_for_ids(conn, ids):
    marks = ",".join("?" * len(ids))
    rows = conn.execute(f"""
        SELECT p.id, p.title, p.company, p.url, p.last_checked, p.expires_at,
               s.total_score
        FROM positions p
        LEFT JOIN (SELECT position_id, MAX(total_score) AS total_score
                   FROM scores GROUP BY position_id) s ON s.position_id = p.id
        WHERE p.id IN ({marks})
        ORDER BY COALESCE(s.total_score, 0) DESC
    """, tuple(ids)).fetchall()
    return rows


def _expired_by_date(conn, row):
    """True se expires_at è valorizzata e già passata (confronto in SQL,
    stessa semantica delle query di coda)."""
    if not row["expires_at"]:
        return False
    r = conn.execute("SELECT ? < datetime('now') AS gone",
                     (row["expires_at"],)).fetchone()
    return bool(r["gone"])


def main():
    ap = argparse.ArgumentParser(
        description="Pre-filtro meccanico del recheck cadenzato (modalità cura)")
    ap.add_argument("--limit", type=int, default=10,
                    help="Dimensione del batch dalla coda (default 10; bounded per design)")
    ap.add_argument("--ids", type=int, nargs="+", default=None,
                    help="Posizioni specifiche invece della coda")
    ap.add_argument("--min-score", type=int, default=None,
                    help="Override soglia score (default: enrichment policy)")
    ap.add_argument("--older-than-days", type=int, default=None,
                    help="Override anzianità (default: enrichment policy, 14gg)")
    ap.add_argument("--dry-run", action="store_true",
                    help="Solo verifica e report, nessuna scrittura su DB")
    ap.add_argument("--json", action="store_true",
                    help="Report JSON su una riga (il default resta umano)")
    args = ap.parse_args()

    conn = get_db()
    ensure_schema(conn)

    if args.ids:
        rows = _rows_for_ids(conn, args.ids)
    else:
        due = recheck_due_rows(conn, args.min_score, args.older_than_days)
        if due is None:
            print("Recheck cadenzato: OFF per enrichment-policy "
                  "(stato voluto, non un bug). Nessun batch.")
            conn.close()
            sys.exit(1)
        all_rows, _, _ = due
        rows = all_rows[:max(1, args.limit)]
        remaining = len(all_rows) - len(rows)

    results = []
    for row in rows:
        url = row["url"] or ""
        if not url:
            results.append({"id": row["id"], "company": row["company"],
                            "title": row["title"], "score": row["total_score"],
                            "outcome": "REVIEW", "state": "NO_URL",
                            "evidence": "posizione senza URL — serve giudizio"})
            continue
        res = recheck(url, row["title"])
        state = res.get("state")
        expired_date = _expired_by_date(conn, row)
        entry = {"id": row["id"], "company": row["company"],
                 "title": row["title"], "score": row["total_score"],
                 "state": state, "method": res.get("method"),
                 "http": res.get("http"), "evidence": res.get("evidence")}
        if state == "OPEN" and not expired_date:
            entry["outcome"] = "REFRESHED"
            if not args.dry_run:
                # Stessa semantica di db_update.py --last-checked now
                # --is-open true. Nessun cambio di status: qui non si
                # decide niente, si registra solo "verificata viva oggi".
                conn.execute(
                    "UPDATE positions SET "
                    "last_checked = datetime('now', 'localtime'), is_open = 1 "
                    "WHERE id = ?", (row["id"],))
                conn.commit()
        else:
            # CLOSED, OPEN_UNVERIFIED, oppure OPEN ma con expires_at passata
            # (incoerenza da spiegare): TUTTO all'Analista, con l'evidenza.
            entry["outcome"] = ("REVIEW" if state == "CLOSED" or expired_date
                                else "UNVERIFIED")
            if expired_date:
                entry["evidence"] = ((entry.get("evidence") or "") +
                                     " | expires_at già passata")
        results.append(entry)

    conn.close()

    refreshed = [r for r in results if r["outcome"] == "REFRESHED"]
    review = [r for r in results if r["outcome"] == "REVIEW"]
    unverified = [r for r in results if r["outcome"] == "UNVERIFIED"]

    if args.json:
        print(json.dumps({"ok": True, "checked": len(results),
                          "refreshed": len(refreshed),
                          "needs_review": review,
                          "unverified": unverified,
                          "results": results},
                         ensure_ascii=False, default=str))
        return

    print(f"\nRecheck batch — {len(results)} posizioni verificate "
          f"(score DESC{', DRY-RUN' if args.dry_run else ''}):")
    print(f"  OK aperte e aggiornate ({len(refreshed)}): "
          + (", ".join(f"#{r['id']}" for r in refreshed) or "—"))
    if review:
        print(f"\n  DA GIUDICARE — evidenza di chiusura ({len(review)}), "
              "l'esclusione la decidi TU (mai lo script):")
        for r in review:
            print(f"    #{r['id']} [{r['score']}] {r['company']} — {r['title']}")
            print(f"       {r['state']} ({r.get('method')}, http={r.get('http')}): "
                  f"{r['evidence']}")
    if unverified:
        print(f"\n  NON VERIFICABILI ({len(unverified)}) — one-shot browser "
              "tuo, poi decidi (is_open resta invariato):")
        for r in unverified:
            print(f"    #{r['id']} [{r['score']}] {r['company']} — {r['title']}: "
                  f"{r['evidence']}")
    if not args.ids and remaining > 0:
        print(f"\n  In coda restano {remaining} posizioni (prossimi batch).")


if __name__ == "__main__":
    main()
