#!/usr/bin/env python3
"""backfill_role_family_canon.py — ri-mappa one-time del role_family LEGACY drift
alle 15 famiglie canoniche della tassonomia chiusa (agents/_team/role-taxonomy.md).

CONTESTO (Parte B 2026-06-15): la categorizzazione NUOVA segue la tassonomia
(verificato: posizioni post-deploy = 0 drift), ma ~340 categorizzazioni PRE-Part-B
hanno valori free-text non-canonici (47 distinct su barto). L'analista ri-categorizza
solo i NULL/nuovi (RULE-14 role_family IS NULL), NON ri-mappa gli esistenti → il
grafico categoria sul cloud resterebbe frammentato (anche col solo sync incrementale,
non solo col re-push BLOCCO3). Questa UPDATE DETERMINISTICA (niente LLM) collassa il
legacy ai canonici. Mapping AUTORITATIVO fornito da dev1 (appendice role-taxonomy.md).

SICUREZZA:
  - DRY-RUN di default: stampa la risoluzione di OGNI valore non-canonico (→ canonico
    o UNMAPPED) + i count, per review. NON tocca il DB.
  - `--apply` esegue le UPDATE (idempotente: salta i già-canonici; gli UNMAPPED NON
    vengono toccati — restano per decisione manuale, NON forzati a 'Other').
  - Va lanciato sul DB LOCALE della VPS (JHT_DB), poi il sync porta i canonici al cloud.

Uso:
  python3 backfill_role_family_canon.py            # dry-run (piano di ri-mappa)
  python3 backfill_role_family_canon.py --apply    # esegue le UPDATE
"""
import os
import sqlite3
import sys

CANONICAL = {
    "Technical Writing", "Content & UX Writing", "Localization & Translation",
    "Knowledge Management", "Software Engineering", "Data Engineering",
    "Data Science & AI", "DevOps / SRE / Platform", "QA & Testing",
    "Product & Project Mgmt", "Design", "Customer & Technical Support",
    "Engineering (Other)", "Business & Operations", "Other",
}

# Regole ORDINATE (prima match vince). Predicato su role_family lowercase.
# Mapping autoritativo dev1 (chat 2026-06-15 + appendice role-taxonomy.md).
def _p(*subs):
    """match se rf inizia con uno dei prefissi (case-insensitive)."""
    return lambda rf: any(rf.startswith(s) for s in subs)

def _c(*subs):
    """match se rf contiene una delle sottostringhe."""
    return lambda rf: any(s in rf for s in subs)

def _e(*vals):
    """match esatto."""
    return lambda rf: rf in vals

RULES = [
    # → Technical Writing (per-PREFISSO = termine primario; il suffisso
    #   "* / Technical Writing" sta IN FONDO così i prefissi-dominio vincono:
    #   es. "Knowledge Management / Technical Writing" → Knowledge Management).
    (_e("technical editing"), "Technical Writing"),
    (_p("technical writing", "documentation", "document control",
         "technical information", "technical content development"), "Technical Writing"),
    # → Localization & Translation
    (_p("translation", "localization", "interpretation"), "Localization & Translation"),
    # → Content & UX Writing
    (_p("content writing", "digital content", "ux writing"), "Content & UX Writing"),
    (_e("customer operations / writing"), "Content & UX Writing"),
    # → Knowledge Management
    (_p("knowledge management", "knowledge architecture"), "Knowledge Management"),
    # → QA & Testing
    (_p("quality assurance", "quality", "qa", "software testing"), "QA & Testing"),
    # → Data Science & AI
    (_p("data / ai", "data/ai", "data analysis"), "Data Science & AI"),
    # → Customer & Technical Support
    (_p("customer support", "technical support"), "Customer & Technical Support"),
    # → Engineering (Other)
    (_p("civil engineering", "field engineering", "production",
         "manufacturing", "packaging"), "Engineering (Other)"),
    # → Product & Project Mgmt
    (_e("product management"), "Product & Project Mgmt"),
    # → Business & Operations
    (_p("finance", "supply chain"), "Business & Operations"),
    # CATCH-ALL suffisso (ULTIMO): "X / Technical Writing" dove X non è un dominio
    # noto → Technical Writing (appendice dev1 "* / Technical Writing").
    (_c("/ technical writing"), "Technical Writing"),
]


def canonicalize(rf):
    """Ritorna (canonical|None, reason). None = UNMAPPED (lasciare invariato)."""
    if rf is None:
        return None, "null"
    if rf in CANONICAL:
        return rf, "already-canon"
    low = rf.strip().lower()
    for test, canon in RULES:
        if test(low):
            return canon, "mapped"
    return None, "UNMAPPED"


def _db_path():
    env = os.environ.get("JHT_DB")
    if env:
        return env
    jht_home = os.environ.get("JHT_HOME")
    if jht_home:
        return os.path.join(jht_home, "jobs.db")
    return os.path.join(os.path.dirname(__file__), "..", "data", "jobs.db")


def main():
    apply = "--apply" in sys.argv[1:]
    conn = sqlite3.connect(_db_path())
    rows = conn.execute(
        "SELECT role_family, COUNT(*) FROM positions "
        "WHERE role_family IS NOT NULL GROUP BY role_family ORDER BY 2 DESC"
    ).fetchall()
    plan = []       # (drift_value, canonical, count)
    unmapped = []   # (value, count)
    skip_canon = 0
    for rf, cnt in rows:
        canon, reason = canonicalize(rf)
        if reason == "already-canon":
            skip_canon += cnt
        elif reason == "mapped":
            plan.append((rf, canon, cnt))
        else:
            unmapped.append((rf, cnt))

    print("=== PIANO RI-MAPPA role_family legacy → canonico (%s) ===" %
          ("APPLY" if apply else "DRY-RUN"))
    print("Già canonici (invariati): %d posizioni" % skip_canon)
    print("Da ri-mappare: %d valori, %d posizioni" %
          (len(plan), sum(c for _, _, c in plan)))
    for rf, canon, cnt in plan:
        print("  %-36s → %-26s (%d)" % (rf[:36], canon, cnt))
    if unmapped:
        print("UNMAPPED (NON toccati — decisione manuale dev1): %d valori" % len(unmapped))
        for rf, cnt in unmapped:
            print("  %-36s   ??? (%d)" % (rf[:36], cnt))

    if apply and plan:
        for rf, canon, _ in plan:
            conn.execute(
                "UPDATE positions SET role_family = ?, "
                "updated_at = CURRENT_TIMESTAMP WHERE role_family = ?",
                (canon, rf))
        conn.commit()
        print("APPLIED: %d valori ri-mappati." % len(plan))
    elif not apply:
        print("(dry-run: niente scritto. Rilancia con --apply per eseguire.)")
    conn.close()


if __name__ == "__main__":
    main()
