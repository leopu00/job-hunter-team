#!/usr/bin/env python3
"""role_taxonomy.py — UNICA fonte di verità (in codice) per `positions.role_family`.

Il problema (2026-06-15, feedback utente): finché la categoria è SOLO un'istruzione
nel prompt ("l'analista DOVREBBE mappare alla tassonomia"), un LLM può inventare una
variante a ogni run → DRIFT che si ricrea (es. "Translation / Localization" vs il
canonico "Localization & Translation"). Patchare i dati sulle VPS è sbagliato: il fix
deve essere A MONTE, nel codice, e rendere il drift IMPOSSIBILE alla SCRITTURA.

Questo modulo è l'enforcement: `normalize()` mappa QUALUNQUE valore a UNO dei canonici
(o `Other`), così il DB non può contenere drift, indipendentemente da cosa produce l'LLM.
Va chiamato nel punto di scrittura (db_update.py --role-family). Mirror di
agents/_team/role-taxonomy.md (lista chiusa che l'analista legge); la crescita
deliberata (TAXONOMY-PROPOSAL → review → add) aggiorna ENTRAMBI.
"""
from __future__ import annotations

# Lista CHIUSA (mirror role-taxonomy.md). 15 famiglie.
CANONICAL = (
    "Technical Writing", "Content & UX Writing", "Localization & Translation",
    "Knowledge Management", "Software Engineering", "Data Engineering",
    "Data Science & AI", "DevOps / SRE / Platform", "QA & Testing",
    "Product & Project Mgmt", "Design", "Customer & Technical Support",
    "Engineering (Other)", "Business & Operations", "Other",
)
CANONICAL_SET = set(CANONICAL)


def _p(*subs):
    return lambda rf: any(rf.startswith(s) for s in subs)


def _c(*subs):
    return lambda rf: any(s in rf for s in subs)


def _e(*vals):
    return lambda rf: rf in vals


# Regole ORDINATE drift→canonico (mapping autoritativo dev1, appendice role-taxonomy.md).
# Principio "termine primario vince": i prefissi-dominio precedono il suffisso
# "* / Technical Writing" (in fondo) → "Knowledge Management / Technical Writing"
# risolve a Knowledge Management, non Technical Writing.
RULES = [
    (_e("technical editing"), "Technical Writing"),
    (_p("technical writing", "documentation", "document control",
        "technical information", "technical content development"), "Technical Writing"),
    (_p("translation", "localization", "interpretation"), "Localization & Translation"),
    (_p("content writing", "digital content", "ux writing"), "Content & UX Writing"),
    (_e("customer operations / writing"), "Content & UX Writing"),
    (_p("knowledge management", "knowledge architecture"), "Knowledge Management"),
    (_p("quality assurance", "quality", "qa", "software testing"), "QA & Testing"),
    (_p("data / ai", "data/ai", "data analysis"), "Data Science & AI"),
    (_p("customer support", "technical support"), "Customer & Technical Support"),
    (_p("civil engineering", "field engineering", "production",
        "manufacturing", "packaging"), "Engineering (Other)"),
    (_e("product management"), "Product & Project Mgmt"),
    (_p("finance", "supply chain"), "Business & Operations"),
    # Dominio DEV (gap segnalato da dev1: il drift tech-writer di betaB non copriva i
    # ruoli dev). Data Engineering PRIMA di Data Science così "data engineer" non
    # finisce in Data Science. Substring word-ish (niente "swe" nudo: troppo greedy).
    (_c("data engineer", "etl", "data pipeline", "data platform", "bi engineer"),
        "Data Engineering"),
    (_c("data scien", "machine learning", "ml engineer", "ai engineer", "ai/ml",
        "data analy", "deep learning", "mlops"), "Data Science & AI"),
    (_c("devops", "sre", "site reliability", "platform engineer",
        "infrastructure engineer", "cloud engineer"), "DevOps / SRE / Platform"),
    (_c("software engineer", "backend", "frontend", "front end", "full stack",
        "full-stack", "fullstack", "embedded", "firmware", "mobile developer",
        "web developer"), "Software Engineering"),
    (_c("/ technical writing"), "Technical Writing"),  # catch-all suffisso, ULTIMO
]


def canonicalize(rf):
    """(canonical|None, reason). None = UNMAPPED (sconosciuto). Per analisi/backfill."""
    if rf is None:
        return None, "null"
    s = rf.strip()
    if not s:
        return None, "empty"
    if s in CANONICAL_SET:
        return s, "already-canon"
    low = s.lower()
    for test, canon in RULES:
        if test(low):
            return canon, "mapped"
    return None, "UNMAPPED"


def normalize(rf):
    """ENFORCEMENT alla scrittura: ritorna SEMPRE un canonico, MAI drift.

    - None / "" → None (lascia NULL, l'analista lo setterà).
    - già canonico → invariato.
    - variante drift nota → canonico mappato.
    - sconosciuto → "Other" (drift-proof; la crescita deliberata avviene via
      TAXONOMY-PROPOSAL, non lasciando entrare free-text).
    """
    if rf is None:
        return None
    if not str(rf).strip():
        return None
    canon, _ = canonicalize(rf)
    return canon if canon is not None else "Other"
