#!/usr/bin/env python3
"""deadline_extract — parser leggero per `positions.deadline` (F-4 task #50).

Lo Scout/Analista chiama questa skill PRIMA di inserire una position per
estrarre la deadline dal JD. Casi tipici (English + Italiano):

  "apply by 2026-06-15"
  "deadline: June 15, 2026"
  "applications close on Friday"
  "expires in 30 days"
  "le candidature chiudono il 15/06/2026"
  "scadenza: 15 giugno"

Strategia conservativa: estrae solo se MATCH ad alta confidenza
(ISO date, "Month dd[, yyyy]", "dd/mm[/yyyy]", "expires in N days").
Altrimenti ritorna None — meglio NULL nel DB che data inventata.

CLI:
    python3 /app/shared/skills/deadline_extract.py < jd.txt
    cat jd.txt | python3 /app/shared/skills/deadline_extract.py
    python3 /app/shared/skills/deadline_extract.py --jd "apply by 2026-06-15"

Output: ISO date (YYYY-MM-DD) o stringa vuota se non trovata.
Exit code 0 sempre (caller deve solo controllare se output != "").
"""
from __future__ import annotations

import argparse
import re
import sys
from datetime import date, datetime, timedelta


MONTHS = {
    "jan": 1, "january": 1, "gen": 1, "gennaio": 1,
    "feb": 2, "february": 2, "febbraio": 2,
    "mar": 3, "march": 3, "marzo": 3,
    "apr": 4, "april": 4, "aprile": 4,
    "may": 5, "maggio": 5, "mag": 5,
    "jun": 6, "june": 6, "giu": 6, "giugno": 6,
    "jul": 7, "july": 7, "lug": 7, "luglio": 7,
    "aug": 8, "august": 8, "ago": 8, "agosto": 8,
    "sep": 9, "sept": 9, "september": 9, "set": 9, "settembre": 9,
    "oct": 10, "october": 10, "ott": 10, "ottobre": 10,
    "nov": 11, "november": 11, "novembre": 11,
    "dec": 12, "december": 12, "dic": 12, "dicembre": 12,
}


def _today() -> date:
    return datetime.now().date()


def _iso(y: int, m: int, d: int) -> str | None:
    try:
        return date(y, m, d).isoformat()
    except ValueError:
        return None


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def parse_deadline(text: str) -> str | None:
    """Ritorna ISO date string o None se nessun match a confidenza alta.

    Cerco in ordine: ISO, num/num/year, Month dd[, yyyy], "expires in N days".
    Stop al primo match ragionevole (no fuzzy ranking — meglio None che data
    sbagliata).
    """
    t = _norm(text).lower()
    if not t:
        return None

    today = _today()

    # 1. ISO YYYY-MM-DD (anche dentro "by 2026-06-15", "deadline 2026-06-15")
    m = re.search(r"\b(\d{4})-(\d{2})-(\d{2})\b", t)
    if m:
        iso = _iso(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        if iso and date.fromisoformat(iso) >= today:
            return iso

    # 2. dd/mm/yyyy or dd-mm-yyyy (formato EU)
    m = re.search(r"\b(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})\b", t)
    if m:
        d_, mo_, y_ = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if y_ < 100:
            y_ += 2000
        iso = _iso(y_, mo_, d_)
        if iso and date.fromisoformat(iso) >= today:
            return iso

    # 3. "Month dd[, yyyy]" oppure "dd Month [yyyy]" (EN + IT)
    months_alt = "|".join(MONTHS.keys())
    # "June 15, 2026" / "June 15 2026" / "June 15"
    m = re.search(rf"\b({months_alt})\s+(\d{{1,2}})(?:[,\s]+(\d{{4}}))?\b", t)
    if m:
        mo_ = MONTHS[m.group(1)]
        d_ = int(m.group(2))
        y_ = int(m.group(3)) if m.group(3) else today.year
        iso = _iso(y_, mo_, d_)
        if iso:
            parsed = date.fromisoformat(iso)
            # Senza anno: se è già passato quest'anno, intendiamo l'anno prossimo
            if not m.group(3) and parsed < today:
                iso = _iso(y_ + 1, mo_, d_)
            if iso and date.fromisoformat(iso) >= today:
                return iso

    # "15 giugno 2026" / "15 June"
    m = re.search(rf"\b(\d{{1,2}})\s+({months_alt})(?:\s+(\d{{4}}))?\b", t)
    if m:
        d_ = int(m.group(1))
        mo_ = MONTHS[m.group(2)]
        y_ = int(m.group(3)) if m.group(3) else today.year
        iso = _iso(y_, mo_, d_)
        if iso:
            parsed = date.fromisoformat(iso)
            if not m.group(3) and parsed < today:
                iso = _iso(y_ + 1, mo_, d_)
            if iso and date.fromisoformat(iso) >= today:
                return iso

    # 4. "expires in N days" / "closes in N days" / "scade fra N giorni"
    m = re.search(
        r"\b(?:expires?|closes?|deadline|scade|chiude)\s+(?:in\s+|fra\s+|tra\s+|entro\s+)?(\d+)\s+(?:days?|giorni)\b",
        t,
    )
    if m:
        n = int(m.group(1))
        return (today + timedelta(days=n)).isoformat()

    # 5. Hint words senza data → skip (meglio NULL che inventato)
    return None


def main(argv):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--jd", help="Testo JD inline (alternativa a stdin)")
    args = p.parse_args(argv)

    text = args.jd if args.jd else sys.stdin.read()
    res = parse_deadline(text) or ""
    print(res)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
