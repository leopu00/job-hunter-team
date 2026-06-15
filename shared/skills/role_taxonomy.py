#!/usr/bin/env python3
"""role_taxonomy.py — MECCANICA (sola) della tassonomia EMERGENTE di `positions.role_family`.

Contesto (2026-06-15, GO utente "Confermo, costruite"): la tassonomia dei ruoli è
EMERGENTE e data-driven. **ZERO categorie hardcoded** — niente lista canonica,
niente RULES/enumerazioni, niente seed, niente nomi di dominio scritti da noi. Le
categorie le DECIDE e le NOMINA il team leggendo le offerte vere; nascono per
soglia di supporto (pass di promozione) e vivono in `role_family_registry`
(per-user). In codice resta SOLO la meccanica.

Questo modulo espone l'UNICO pezzo meccanico che vive qui: `normalize_key()`, la
CHIAVE DI CLUSTERING generica condivisa da:
  • il write-guard (db_update): surface-match di un'etichetta verso le categorie
    ATTIVE del registro;
  • il pass di promozione (lane registro): raggruppa le righe-sentinella ('Other')
    per `normalize_key(role_family_proposed)`.

CONFINE (concordato in chat 2026-06-15, dev1+dev2+dse3, review GREEN): `normalize_key`
risolve SOLO le varianti di SUPERFICIE — maiuscole/minuscole, spazi, punteggiatura,
connettori strutturali, ordine dei token. NON risolve abbreviazioni/sinonimi
('PE'↔'Private Equity', 'RN'↔'Registered Nurse'): una mappa-sinonimi sarebbe
hardcoding/fitting. Sinonimi/abbreviazioni si collassano altrove, in modo generico:
match-first SEMANTICO dell'analista verso le attive + merge-near-dup nel pass di
promozione. Qui dentro: zero nomi di categoria, zero sinonimi di dominio.

L'UNICA "lista" è l'insieme dei CONNETTORI strutturali ('&','and','/','+','-',
'|',',') — giunti universali fra parole (qualunque lingua/dominio), NON nomi di
categoria. È meccanica, non tassonomia. (Le stop-word 'of/for/the' NON sono
scartate di proposito: sono lingua-specifiche e introdurrebbero bias EN; i casi
'Head of Engineering' vs 'Engineering Head' li cattura il match-first/merge-near-dup.)

Modulo PURO: nessun import oltre `re`, nessun DB/VPS, nessuno stato.
"""
from __future__ import annotations

import re

# Connettori STRUTTURALI di superficie. I simboli ('&','/','-','+','|',',')
# diventano comunque spazio in _NON_WORD; qui conta soprattutto la parola 'and'
# ('R&D' == 'R and D'). Meccanica, non tassonomia.
_CONNECTORS = {"and", "&", "/", "+", "-", "–", "—", "|", ","}

# Tutto ciò che non è lettera/cifra/spazio → spazio (punteggiatura e simboli via).
_NON_WORD = re.compile(r"[^a-z0-9\s]+")
_WS = re.compile(r"\s+")


def normalize_key(label):
    """Chiave di clustering GENERICA per un'etichetta role_family (raw).

    Solo varianti di SUPERFICIE collassate. Ritorna "" per input vuoto/None o
    per etichette tutte-punteggiatura/connettori (non formano cluster → il
    chiamante DEVE skippare le chiavi "").

    Pipeline (tutta meccanica, zero nomi):
      1. lower + trim
      2. punteggiatura/simboli → spazio (i connettori-simbolo '&','/','-'… qui)
      3. tokenizza; scarta i connettori-parola ('and') e i token vuoti
      4. token-sort + dedup → l'ordine non conta ('VC PE' == 'PE VC')
      5. join con spazio singolo
    """
    if label is None:
        return ""
    s = str(label).strip().lower()
    if not s:
        return ""
    s = _NON_WORD.sub(" ", s)
    s = _WS.sub(" ", s).strip()
    if not s:
        return ""
    tokens = [t for t in s.split(" ") if t and t not in _CONNECTORS]
    if not tokens:
        return ""
    tokens = sorted(set(tokens))
    return " ".join(tokens)
