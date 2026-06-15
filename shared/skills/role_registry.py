#!/usr/bin/env python3
"""role_registry.py — pass di PROMOZIONE della tassonomia EMERGENTE.

Lane dev2 (DB substrate + behavior). Trasforma la coda della sentinella catch-all
in categorie ATTIVE **senza alcun nome hardcoded**: raggruppa le righe-sentinella
per ``normalize_key(role_family_proposed)`` e, quando un cluster raggiunge la
soglia di supporto, **promuove** una categoria il cui NOME è scelto DAI DATI
(l'etichetta proposta più frequente del cluster), ri-taggando le sue posizioni.
Backstop: max ~20 categorie attive per-utente (le meno supportate tornano
dormienti).

Confine netto:
- i NOMI delle categorie li decide il team/i dati, mai questo codice;
- la sola meccanica condivisa è ``normalize_key`` (superficie: case/spazi/
  punteggiatura/connettori/token-sort+dedup), importata da ``role_taxonomy``
  (fonte unica, lane dse3) — nessun mirror.

CLI::

    python3 role_registry.py                 # pass sul candidato locale (commit)
    python3 role_registry.py --dry-run       # mostra cosa farebbe, niente commit
    python3 role_registry.py --threshold 8 --cap 15
"""

import argparse
import sys
from collections import Counter, defaultdict

# Fonte UNICA della normalizzazione (mechanics surface-only, lane dse3).
# Si fonde in role_taxonomy.py al posto di CANONICAL/RULES nel landing dse3.
from role_taxonomy import normalize_key
from _db import get_db, ensure_schema, local_user_id, active_categories

# Sentinella catch-all confermata a 3 (valore DB stabile/neutro; la UI i18n
# la mostra 'Altro'). Guard (db_update) e questo pass usano LA STESSA stringa.
SENTINEL = "Other"

# PALETTO DIREZIONALE, non regola ferrea (feedback utente 2026-06-15). Il numero
# IDEALE di categorie (~5-8, RELATIVO ai dati) è giudizio degli ANALISTI nel prompt
# (decidono insieme via il registro condiviso, aggregano le simili, si adattano).
# Qui la soglia è solo un PAVIMENTO anti-frammentazione (evita che 1 offerta diventi
# una categoria → il problema dei 43 singleton) e il cap un TETTO di sicurezza —
# meccanica, non la regola. Knob regolabile (CLI / futuro config).
DEFAULT_THRESHOLD = 5   # pavimento: min offerte simili perché una categoria abbia senso
DEFAULT_CAP = 20        # tetto: max categorie attive per-utente (backstop)


def recompute_support(conn, user_id):
    """Aggiorna ``support_count`` di ogni attiva = #positions con quel role_family."""
    names = [r[0] for r in conn.execute(
        "SELECT name FROM role_family_registry WHERE user_id = ? AND status = 'active'",
        (user_id,),
    ).fetchall()]
    for name in names:
        n = conn.execute(
            "SELECT COUNT(*) FROM positions WHERE role_family = ?", (name,)
        ).fetchone()[0]
        conn.execute(
            "UPDATE role_family_registry SET support_count = ? WHERE user_id = ? AND name = ?",
            (n, user_id, name),
        )


def find_clusters(conn, user_id):
    """Raggruppa per ``normalize_key`` le posizioni NON ancora in una categoria attiva.

    DUE sorgenti (unifica BOOTSTRAP + promozione, su richiesta dse3, endorsato dev1):
    - **coda sentinella**: righe `role_family='Other'` → etichetta = `role_family_proposed`;
    - **legacy / cold-start**: righe con `role_family` valorizzato, ≠ 'Other' e NON già
      attivo → etichetta = `role_family`. Così i valori legacy comuni (es.
      'Business & Operations' ×160, 'Backend Engineering' ×116) diventano attivi
      SUBITO e non innescano lo storm di ri-analisi di tutto il backlog.

    Ritorna ``(clusters, active_key_map)``:
    - ``clusters = {key: [(id, label), …]}`` (chiavi vuote SKIPPATE — dev1 nota #2);
    - ``active_key_map = {normalize_key(nome_attivo): nome_attivo}`` per il FOLD
      delle varianti di superficie su un'attiva esistente.
    """
    active = active_categories(conn, user_id)
    active_set = set(active)
    active_key_map = {}
    for name in active:
        k = normalize_key(name)
        if k:
            active_key_map[k] = name
    sentinel_rows = conn.execute(
        "SELECT id, role_family_proposed AS label FROM positions "
        "WHERE role_family = ? "
        "  AND role_family_proposed IS NOT NULL AND TRIM(role_family_proposed) <> ''",
        (SENTINEL,),
    ).fetchall()
    legacy_rows = conn.execute(
        "SELECT id, role_family AS label FROM positions "
        "WHERE role_family IS NOT NULL AND TRIM(role_family) <> '' AND role_family <> ?",
        (SENTINEL,),
    ).fetchall()
    clusters = defaultdict(list)
    candidates = list(sentinel_rows) + [r for r in legacy_rows if r["label"] not in active_set]
    for r in candidates:
        key = normalize_key(r["label"])
        if not key:            # chiave vuota → skip (dev1 nota #2)
            continue
        clusters[key].append((r["id"], r["label"]))
    return clusters, active_key_map


def _retag(conn, ids, name):
    placeholders = ",".join("?" * len(ids))
    conn.execute(
        f"UPDATE positions SET role_family = ? WHERE id IN ({placeholders})",
        (name, *ids),
    )


def promote(conn, user_id, threshold, apply=True):
    """Promuove/folda i cluster. Ritorna list[(name, count, 'new'|'fold')].

    Per ogni cluster (chiave normalizzata):
    - chiave == una categoria ATTIVA esistente → **fold**: ri-tagga i membri su
      quell'attiva (qualunque dimensione: è una variante di superficie);
    - altrimenti supporto ≥ ``threshold`` → **promote NEW**: il NOME = l'etichetta
      più frequente del cluster (scelta DAI DATI), crea/riattiva la categoria, ri-tagga;
    - altrimenti → skip (resta: l'analista lo ri-categorizza via next-for-categorize
      se è drift, o resta nella sentinella se è coda).

    ``apply=False`` → non scrive (dry-run).
    """
    clusters, active_key_map = find_clusters(conn, user_id)
    out = []
    for key, members in clusters.items():
        ids = [pid for pid, _ in members]
        if key in active_key_map:
            name = active_key_map[key]
            out.append((name, len(members), "fold"))
            if apply:
                _retag(conn, ids, name)
            continue
        if len(members) < threshold:
            continue
        name = Counter(lbl for _, lbl in members).most_common(1)[0][0]
        out.append((name, len(members), "new"))
        if not apply:
            continue
        conn.execute(
            "INSERT INTO role_family_registry "
            "  (user_id, name, status, support_count, promoted_at, created_at) "
            "VALUES (?, ?, 'active', ?, datetime('now','localtime'), datetime('now','localtime')) "
            "ON CONFLICT(user_id, name) DO UPDATE SET "
            "  status = 'active', support_count = excluded.support_count, "
            "  promoted_at = COALESCE(role_family_registry.promoted_at, excluded.promoted_at)",
            (user_id, name, len(members)),
        )
        _retag(conn, ids, name)
    return out


def enforce_cap(conn, user_id, cap, apply=True):
    """Se le attive superano ``cap``, le meno-supportate tornano dormienti.

    Le loro posizioni rientrano nella sentinella (con ``role_family_proposed``
    = nome demoto, per conservare la provenienza e ri-clusterizzare in futuro).
    NB hysteresis anti-flapping (promote ≥ N, demote < M<N): refinement v2
    (dev1) — qui il cap è un backstop secco, hit raro (>20 categorie emergenti).
    Ritorna la lista demota. ``apply=False`` → non scrive.
    """
    actives = conn.execute(
        "SELECT name, support_count FROM role_family_registry "
        "WHERE user_id = ? AND status = 'active' "
        "ORDER BY support_count DESC, name ASC",
        (user_id,),
    ).fetchall()
    overflow = actives[cap:]
    demoted = []
    for name, _support in overflow:
        demoted.append(name)
        if not apply:
            continue
        conn.execute(
            "UPDATE role_family_registry SET status = 'dormant' "
            "WHERE user_id = ? AND name = ?",
            (user_id, name),
        )
        conn.execute(
            "UPDATE positions SET "
            "  role_family_proposed = COALESCE(role_family_proposed, role_family), "
            "  role_family = ? "
            "WHERE role_family = ?",
            (SENTINEL, name),
        )
    return demoted


def run_pass(conn, user_id=None, threshold=DEFAULT_THRESHOLD, cap=DEFAULT_CAP,
             apply=True):
    """Esegue il pass completo: promote → recompute → cap → recompute.

    ``user_id=None`` → candidato locale. Ritorna un dict riassuntivo.
    ``apply=False`` (dry-run) → calcola e ritorna senza scrivere/committare.

    Auto-sicuro a DB cold: ``ensure_schema`` garantisce tabella+colonna prima di
    qualunque query → chiamabile dal bridge anche al primo tick post-boot senza
    pre-condizioni (idempotente, a vuoto ritorna promote/demote vuoti).
    """
    ensure_schema(conn)
    if user_id is None:
        user_id = local_user_id()
    promoted = promote(conn, user_id, threshold, apply=apply)
    if apply:
        recompute_support(conn, user_id)
    demoted = enforce_cap(conn, user_id, cap, apply=apply)
    if apply:
        recompute_support(conn, user_id)
        conn.commit()
    return {
        "user_id": user_id,
        "promoted": promoted,
        "demoted": demoted,
        "active": active_categories(conn, user_id, with_support=True),
    }


def main():
    ap = argparse.ArgumentParser(description="Pass di promozione tassonomia emergente")
    ap.add_argument("--user-id", default=None,
                    help="omesso → candidato locale (default VPS single-candidate)")
    ap.add_argument("--threshold", type=int, default=DEFAULT_THRESHOLD,
                    help=f"supporto minimo per promuovere (default {DEFAULT_THRESHOLD})")
    ap.add_argument("--cap", type=int, default=DEFAULT_CAP,
                    help=f"max categorie attive per-utente (default {DEFAULT_CAP})")
    ap.add_argument("--dry-run", action="store_true",
                    help="mostra cosa farebbe, nessuna scrittura")
    args = ap.parse_args()

    conn = get_db()
    ensure_schema(conn)
    res = run_pass(conn, args.user_id, args.threshold, args.cap, apply=not args.dry_run)
    tag = "[DRY-RUN] " if args.dry_run else ""
    print(f"{tag}user_id={res['user_id']} soglia={args.threshold} cap={args.cap}")
    print(f"{tag}promosse: {res['promoted'] or 'nessuna'}")
    print(f"{tag}demote:   {res['demoted'] or 'nessuna'}")
    print(f"{tag}attive ({len(res['active'])}): {res['active']}")
    conn.close()


if __name__ == "__main__":
    sys.exit(main() or 0)
