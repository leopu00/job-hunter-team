#!/usr/bin/env python3
"""role_normalize_proto.py — PROTOTIPO (non-wired) della normalizzazione GENERICA.

Contesto (2026-06-15, hard-stop utente): la tassonomia delle role_family è
EMERGENTE e data-driven. ZERO categorie hardcoded in codice — niente lista
canonica, niente RULES/enumerazioni, niente seed, niente nomi di dominio. In
codice resta SOLO la MECCANICA. Questa funzione è il cuore meccanico condiviso:
la CHIAVE DI CLUSTERING usata sia dal write-guard (match) sia dal pass di
promozione (raggruppa le proposte dentro 'Altro').

CONFINE (fissato in chat il 12:53, dev1+dse3): `normalize()` risolve SOLO le
varianti di SUPERFICIE — maiuscole/minuscole, spazi, punteggiatura, connettori,
ordine dei token. NON risolve abbreviazioni/sinonimi ('PE'↔'Private Equity',
'RN'↔'Registered Nurse'): quella sarebbe una mappa-sinonimi = hardcoding/fitting
che l'utente rifiuta. Sinonimi/abbreviazioni si collassano altrove, in modo
generico: (1) MATCH-FIRST semantico dell'analista verso le categorie ATTIVE del
registro; (2) MERGE near-dup nel pass di promozione. Qui dentro: zero nomi, zero
sinonimi di dominio.

L'UNICA "lista" è l'insieme dei CONNETTORI strutturali ('&','and','/','+','-',
'|',',') — connettori di superficie universali (qualunque lingua/dominio), NON
nomi di categoria. È meccanica, non tassonomia.

Pura: nessun import oltre `re`, nessun DB/VPS, nessuno stato. Testabile da sola
(`python3 role_normalize_proto.py`).

Quando il 3-way + l'interfaccia registro di dev2 sono chiusi, questa funzione si
fonde in role_taxonomy.py al posto di CANONICAL/RULES.
"""
from __future__ import annotations

import re

# Connettori STRUTTURALI di superficie → collassati a separatore. NON sono nomi
# di categoria: sono i giunti universali fra parole ('R&D' == 'R and D',
# 'Private Equity / VC' == 'Private Equity & VC'). Meccanica, non tassonomia.
_CONNECTORS = {"and", "&", "/", "+", "-", "–", "—", "|", ","}

# Tutto ciò che non è lettera/cifra/spazio diventa spazio (punteggiatura via).
_NON_WORD = re.compile(r"[^a-z0-9\s]+")
_WS = re.compile(r"\s+")


def normalize_key(label):
    """Chiave di clustering GENERICA per un'etichetta role_family (raw).

    Solo varianti di SUPERFICIE collassate. Ritorna "" per input vuoto/None.

    Pipeline (tutta meccanica, zero nomi):
      1. lower + trim
      2. punteggiatura → spazio (i connettori simbolo '&','/','-'… spariscono qui)
      3. tokenizza; scarta i connettori-parola ('and') e i token vuoti
      4. token-sort + dedup  → l'ordine non conta ('VC PE' == 'PE VC')
      5. join con spazio singolo
    """
    if label is None:
        return ""
    s = str(label).strip().lower()
    if not s:
        return ""
    # punteggiatura e connettori-simbolo → spazio
    s = _NON_WORD.sub(" ", s)
    s = _WS.sub(" ", s).strip()
    if not s:
        return ""
    tokens = [t for t in s.split(" ") if t and t not in _CONNECTORS]
    if not tokens:
        return ""
    # dedup preservando l'insieme, poi sort → invariante all'ordine
    tokens = sorted(set(tokens))
    return " ".join(tokens)


def same_cluster(a, b):
    """True se due etichette raw collassano sulla stessa chiave di superficie."""
    return normalize_key(a) == normalize_key(b) != ""


# --------------------------------------------------------------------------- #
# SELF-TEST — `python3 role_normalize_proto.py`
# --------------------------------------------------------------------------- #
def _run_tests():
    # (1) DEVONO clusterizzare = varianti di superficie (ordine/punteggiatura/case/connettori)
    same = [
        ("Private Equity / VC", "VC / Private Equity"),            # ordine
        ("Private Equity & Venture Capital",
         "Private Equity and Venture Capital"),                    # & == and
        ("Software Engineering", "software   engineering"),        # case + spazi
        (" Software-Engineering ", "Software Engineering"),        # trattino == spazio
        ("Mergers & Acquisitions", "Mergers and Acquisitions"),    # & == and
        ("R&D", "R and D"),                                        # simbolo+parola
        ("Data Science / AI", "AI / Data Science"),                # ordine
        ("Full-Stack Developer", "full stack developer"),          # trattino
        ("QA / Testing", "Testing, QA"),                           # virgola+ordine
        ("Localization & Translation", "Translation / Localization"),  # ordine+connettore
    ]
    # (2) NON DEVONO clusterizzare = abbreviazioni/sinonimi (li prende il match-first, non qui)
    diff = [
        ("PE", "Private Equity"),                 # abbreviazione
        ("RN", "Registered Nurse"),               # abbreviazione
        ("ML", "Machine Learning"),               # abbreviazione
        ("SWE", "Software Engineering"),          # abbreviazione
        ("Frontend", "Frontend Developer"),       # subset ≠ superficie (token in più)
        ("Data Engineer", "Data Scientist"),      # token diverso
    ]
    # (3) input vuoti → ""
    empties = [None, "", "   ", "  /  ", " & - ", ",,,"]

    failures = []
    for a, b in same:
        if not same_cluster(a, b):
            failures.append(f"ATTESO == : {a!r} ({normalize_key(a)!r}) vs {b!r} ({normalize_key(b)!r})")
    for a, b in diff:
        if same_cluster(a, b):
            failures.append(f"ATTESO != : {a!r} ({normalize_key(a)!r}) vs {b!r} ({normalize_key(b)!r})")
    for e in empties:
        if normalize_key(e) != "":
            failures.append(f"ATTESO '' : {e!r} -> {normalize_key(e)!r}")

    print("=== role_normalize_proto — self-test ===")
    print(f"superficie-clusterizza : {len(same)} casi")
    print(f"abbrev-NON-clusterizza : {len(diff)} casi (boundary dev1 12:53)")
    print(f"vuoti -> ''            : {len(empties)} casi")
    print("--- esempi di chiave ---")
    for raw in ["Private Equity / VC", "VC / Private Equity", "PE",
                "Mergers & Acquisitions", "Full-Stack Developer", "R&D"]:
        print(f"  {raw!r:32} -> {normalize_key(raw)!r}")
    if failures:
        print(f"\n❌ {len(failures)} FALLITI:")
        for f in failures:
            print("  -", f)
        return 1
    print(f"\n✅ TUTTI VERDI ({len(same)+len(diff)+len(empties)} asserzioni)")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(_run_tests())
