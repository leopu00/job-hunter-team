#!/usr/bin/env python3
"""role_registry.py — registro della tassonomia EMERGENTE (storage + primitive).

Modello **BRAIN-DRIVEN** (2026-06-20). La decisione su QUALI famiglie esistono e
quali offerte ci vanno è del GIUDIZIO degli agenti (analista + arbitrato Capitano),
NON di un conteggio di stringhe. Questo modulo è solo il substrato che ESEGUE:

- ``promote_family(name, ids)`` — l'analista, visto un grappolo di offerte simili in
  ``Other``, decide la famiglia e i membri → qui si crea l'attiva e si ri-taggano;
- ``merge_families(sources, into)`` — verdetto MERGE del Capitano sui near-duplicate;
- ``recompute_support`` / ``enforce_cap`` — meccanica di supporto (conteggi, tetto).

Confine netto: i NOMI delle categorie e l'appartenenza li decidono gli agenti, mai
questo codice. NIENTE liste hardcoded.

LEGACY (NON nel percorso decisionale): ``promote()``/``run_pass()`` erano il vecchio
pass a ``normalize_key`` + soglia che raggruppava per stringa identica. Frammentava
("VC Investing" vs "VC / Growth Investing" = 2 cluster) → 0 promozioni, tutto fermo in
``Other`` (rootcause betaA 2026-06-20). NON è più auto-schedulato dal bridge; resta
solo come diagnostica manuale (``pass --apply``). ``normalize_key`` resta usato solo
dal write-guard per il fold di varianti di superficie su un'attiva ESISTENTE.

CLI::

    python3 role_registry.py promote --name "Investment Banking / M&A" --ids 358,364,377
    python3 role_registry.py merge --into "Credit" --sources "Private Credit" "Corporate Credit"
    python3 role_registry.py pass               # [legacy] diagnosi (dry-run; --apply per applicare)
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

# GUARD ANTI CATCH-ALL (2026-06-16, lezione betaA). Un legacy GIA' collassato
# (vecchia run free-text che ha buttato la maggioranza in UN bucket generico, es.
# 'Business & Operations' ×175 + 61 etichette finance distinte sotto-soglia) farebbe
# promuovere al bootstrap SOLO quel mega-bucket come seed UNICO → l'analista si fida
# del menù da una voce e il collasso si auto-perpetua. Al BOOTSTRAP (registro vuoto):
# se l'UNICO cluster ≥soglia domina il corpus (≥ DOMINANCE) E esiste una coda diversa
# sotto-soglia (≥ TAIL_MIN etichette distinte) → quel cluster NON è una famiglia, è
# residuo: viene SOPPRESSO (resta drift, non promosso) → cold-start, l'analista
# judge-first ricostruisce le famiglie vere. Bootstrap-gated (solo registro vuoto) +
# auto-limitante (con ≥2 famiglie reali non scatta) → non disturba un registro sano
# multi-categoria (i 12 di betaB). La coda piccola di un candidato GENUINAMENTE
# mono-famiglia (1 vera famiglia + 2-3 one-off) NON innesca: discrimina TAIL_MIN.
CATCHALL_DOMINANCE = 0.35   # frazione del corpus oltre cui un seed unico è "dominante"
CATCHALL_TAIL_MIN = 8       # # etichette distinte sotto-soglia = diversità soppressa


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


def _detect_catchall_seed(clusters, active_key_map, threshold,
                          dominance=CATCHALL_DOMINANCE, tail_min=CATCHALL_TAIL_MIN):
    """Ritorna la CHIAVE del cluster catch-all da NON promuovere, o ``None``.

    Funzione PURA (niente DB) → unit-testabile. Scatta SOLO al bootstrap (registro
    vuoto: ``active_key_map`` vuoto) e SOLO nel caso degenere: un UNICO cluster
    ≥soglia, che domina il corpus (≥ ``dominance``) mentre esiste una coda diversa
    sotto-soglia (≥ ``tail_min`` etichette distinte). In ogni altro caso ritorna
    ``None`` (registro già seminato, più cluster promovibili, coda piccola di un
    candidato genuinamente mono-famiglia) → comportamento invariato.
    """
    if active_key_map:                       # non-bootstrap → guard OFF
        return None
    promotable = [k for k, m in clusters.items()
                  if k not in active_key_map and len(m) >= threshold]
    if len(promotable) != 1:                 # 0 o ≥2 famiglie reali → niente seed unico
        return None
    key = promotable[0]
    total = sum(len(m) for m in clusters.values())
    tail = [k for k, m in clusters.items() if len(m) < threshold]
    if total and (len(clusters[key]) / total) >= dominance and len(tail) >= tail_min:
        return key                           # mega-bucket residuo: sopprimi
    return None


def promote(conn, user_id, threshold, apply=True):
    """Promuove/folda i cluster. Ritorna list[(name, count, 'new'|'fold'|'catchall-skip')].

    Per ogni cluster (chiave normalizzata):
    - chiave == una categoria ATTIVA esistente → **fold**: ri-tagga i membri su
      quell'attiva (qualunque dimensione: è una variante di superficie);
    - chiave == il catch-all degenere del bootstrap (vedi ``_detect_catchall_seed``)
      → **catchall-skip**: NON promosso (resta drift → l'analista judge-first lo
      ri-categorizza), così non si semina un menù da una voce sola;
    - altrimenti supporto ≥ ``threshold`` → **promote NEW**: il NOME = l'etichetta
      più frequente del cluster (scelta DAI DATI), crea/riattiva la categoria, ri-tagga;
    - altrimenti → skip (resta: l'analista lo ri-categorizza via next-for-categorize
      se è drift, o resta nella sentinella se è coda).

    ``apply=False`` → non scrive (dry-run).
    """
    clusters, active_key_map = find_clusters(conn, user_id)
    catchall_key = _detect_catchall_seed(clusters, active_key_map, threshold)
    out = []
    for key, members in clusters.items():
        ids = [pid for pid, _ in members]
        if key in active_key_map:
            name = active_key_map[key]
            out.append((name, len(members), "fold"))
            if apply:
                _retag(conn, ids, name)
            continue
        if key == catchall_key:
            name = Counter(lbl for _, lbl in members).most_common(1)[0][0]
            out.append((name, len(members), "catchall-skip"))
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


def promote_family(conn, user_id, name, ids, apply=True):
    """Promozione **BRAIN-DRIVEN** (2026-06-20): il NOME e i MEMBRI li decide il
    GIUDIZIO dell'agente, non un conteggio di stringhe. Questo codice ESEGUE soltanto.

    L'analista, visto un grappolo di offerte simili in ``Other`` (o sparse in
    micro-varianti), decide la famiglia e i suoi membri e chiama qui:
    - upsert di ``name`` come categoria ATTIVA nel registro (idempotente);
    - ri-tagga le ``ids`` con ``role_family = name`` e azzera ``role_family_proposed``.

    NIENTE soglia, NIENTE ``normalize_key``: la famiglia nasce dal cervello, non dal
    fatto che N stringhe siano identiche (era IL difetto che lasciava tutto in Other).
    Ritorna ``(name, n_membri)``. ``apply=False`` → dry-run.
    """
    name = (name or "").strip()
    if not name:
        raise ValueError("category name is empty")
    if name == SENTINEL:
        raise ValueError(f"'{SENTINEL}' is the holding category, not a family: "
                         "choose a real name")
    ids = [int(i) for i in ids]
    if not ids:
        raise ValueError("no member IDs: a family must come from a cluster")
    if apply:
        conn.execute(
            "INSERT INTO role_family_registry "
            "  (user_id, name, status, support_count, promoted_at, created_at) "
            "VALUES (?, ?, 'active', ?, datetime('now','localtime'), datetime('now','localtime')) "
            "ON CONFLICT(user_id, name) DO UPDATE SET status = 'active', "
            "  promoted_at = COALESCE(role_family_registry.promoted_at, excluded.promoted_at)",
            (user_id, name, len(ids)),
        )
        ph = ",".join("?" * len(ids))
        conn.execute(
            f"UPDATE positions SET role_family = ?, role_family_proposed = NULL "
            f"WHERE id IN ({ph})",
            (name, *ids),
        )
        recompute_support(conn, user_id)
        conn.commit()
    return (name, len(ids))


def merge_families(conn, user_id, sources, into, apply=True):
    """Verdetto **MERGE** del Capitano (2026-06-20): fonde ``sources`` in ``into`` a
    GIUDIZIO (near-duplicate di superficie, es. "IB / M&A Advisory" + "Transaction
    Advisory / M&A" → "Investment Banking / M&A"). Tutte le posizioni delle sources
    passano a ``into``; le sources diventano dormienti con ``merged_into = into``.
    ``into`` può essere una attiva esistente o un nome nuovo. Ritorna ``(into, sources)``.
    """
    into = (into or "").strip()
    if not into:
        raise ValueError("merge: destination 'into' is empty")
    sources = [s.strip() for s in sources if s and s.strip() and s.strip() != into]
    if not sources:
        raise ValueError("merge: at least one source different from 'into' is required")
    if apply:
        conn.execute(
            "INSERT INTO role_family_registry "
            "  (user_id, name, status, support_count, promoted_at, created_at) "
            "VALUES (?, ?, 'active', 0, datetime('now','localtime'), datetime('now','localtime')) "
            "ON CONFLICT(user_id, name) DO UPDATE SET status = 'active'",
            (user_id, into),
        )
        for src in sources:
            conn.execute(
                "UPDATE positions SET role_family = ? WHERE role_family = ?", (into, src)
            )
            conn.execute(
                "UPDATE role_family_registry SET status = 'dormant', merged_into = ? "
                "WHERE user_id = ? AND name = ?",
                (into, user_id, src),
            )
        recompute_support(conn, user_id)
        conn.commit()
    return (into, sources)


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


def _parse_ids(raw):
    out = []
    for tok in (raw or "").replace(",", " ").split():
        tok = tok.strip()
        if tok:
            out.append(int(tok))
    return out


def main():
    ap = argparse.ArgumentParser(
        description="Emergent taxonomy — BRAIN-DRIVEN promotion/merge (the agent "
                    "chooses names and members; the code executes).")
    ap.add_argument("--user-id", default=None,
                    help="omit for the local candidate (single-candidate VPS default)")
    ap.add_argument("--dry-run", action="store_true",
                    help="do not write; show the result")
    sub = ap.add_subparsers(dest="cmd")

    # promote: crea/attiva una famiglia decisa dall'agente e tagga i membri SCELTI da lui
    p_promote = sub.add_parser("promote",
        help="create/activate a category (NAME chosen by you) and tag the "
             "positions YOU judged to belong to it (a cluster from Other or "
             "micro-variants).")
    p_promote.add_argument("--name", required=True,
                           help="family name (agent judgment)")
    p_promote.add_argument("--ids", required=True,
                           help="member position IDs, separated by commas/spaces")

    # merge: verdetto del Capitano per fondere near-duplicate
    p_merge = sub.add_parser("merge",
        help="merge near-duplicate categories into one (Capitano verdict).")
    p_merge.add_argument("--into", required=True, help="destination category")
    p_merge.add_argument("--sources", required=True, nargs="+",
                         help="one or more categories to merge into --into")

    # pass: LEGACY string-clustering — SOLO diagnostica manuale, NON più auto-schedulato
    p_pass = sub.add_parser("pass",
        help="[LEGACY/diagnostics] old string pass (normalize_key+threshold). "
             "It is NO longer in the decision path: use promote/merge. "
             "Defaults to --dry-run.")
    p_pass.add_argument("--threshold", type=int, default=DEFAULT_THRESHOLD)
    p_pass.add_argument("--cap", type=int, default=DEFAULT_CAP)
    p_pass.add_argument("--apply", action="store_true",
                        help="apply changes (default: dry-run only; this is legacy)")

    args = ap.parse_args()
    conn = get_db()
    ensure_schema(conn)
    uid = args.user_id or local_user_id()
    apply = not args.dry_run
    tag = "[DRY-RUN] " if not apply else ""

    if args.cmd == "promote":
        name, n = promote_family(conn, uid, args.name, _parse_ids(args.ids), apply=apply)
        print(f"{tag}promote '{name}' ← {n} positions")
        print(f"active: {active_categories(conn, uid, with_support=True)}")
    elif args.cmd == "merge":
        into, srcs = merge_families(conn, uid, args.sources, args.into, apply=apply)
        print(f"{tag}merge {srcs} → '{into}'")
        print(f"active: {active_categories(conn, uid, with_support=True)}")
    elif args.cmd == "pass":
        res = run_pass(conn, uid, args.threshold, args.cap, apply=args.apply)
        ptag = "" if args.apply else "[DRY-RUN] "
        print(f"{ptag}[LEGACY] promoted: {res['promoted'] or 'none'}")
        print(f"{ptag}[LEGACY] demoted:  {res['demoted'] or 'none'}")
        print(f"{ptag}active ({len(res['active'])}): {res['active']}")
    else:
        ap.print_help()
    conn.close()


if __name__ == "__main__":
    sys.exit(main() or 0)
