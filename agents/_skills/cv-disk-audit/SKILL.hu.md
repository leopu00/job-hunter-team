<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: cv-disk-audit
description: Periodikus egészségügyi ellenőrzés (Dottore) a lemezen lévő CV-k és a DB-beli cv_pdf_path egyeztetésére. Azonosítja az árvákat (fájl a lemezen DB sor nélkül) és szellemeket (DB sor cv_pdf_path-szal, ami nem létező fájlra mutat). Értesíti a Capitano-t az eltérésekről, hogy a felhasználó ne veszítse el a top PASS láthatatlan CV-ket és ne lásson "megírandó CV"-t már megírt CV-khez.
allowed-tools: Bash(python3 *), Bash(find *), Bash(stat *), Bash(jht-tmux-send *)
---

# cv-disk-audit — lemez↔DB egyeztetés a CV-ken

A bug #26 mutatta meg a mintát: a Scrittore generálja a PDF-et, megölik
(EMERGENZA freeze 2026-05-17 04:43) a DB UPDATE előtt. A fájl a
`/jht_user/cv/`-n marad, de az `applications.cv_pdf_path` NULL marad.
A Sisal 7.5/10 (az ablak top PASS-ja) *"megírandó CV"*-vé vált
a felhasználói dashboardon — láthatatlan.

A megelőző javítás (atomic write a `cv-structure` skill-ben) megakadályozza
az új árvákat. Ez az audit összefűzi a már meglévőket és elkapja
minden új eltérést, ami megjelenhet (pl. felhasználó kézzel áthelyez
egy PDF-et, a watchdog megöli az Írót az átnevezés közben).

## Mikor indítsd

Dottore trigger (kör végi, költségvetés-kritikuson kívül):
- Mindig az első körben egy EMERGENZA / Író megölése után.
- Egyébként ~minden 4. Dottore körben (≈2 óra, a 30 perces kör alapján).

A Dottore ezt a skill-t a `liveness-check` UTÁN és a
`cache-prune` ELŐTT hajtja végre — az audit informatív, nem destruktív.

## Eljárás

```bash
# 1. Lemez pillanatkép
DISK_PDFS=$(find /jht_user/cv -maxdepth 1 -type f -name '*.pdf' 2>/dev/null | sort)

# 2. DB pillanatkép (cv_pdf_path != NULL)
DB_PDFS=$(python3 /app/shared/skills/db_query.py cv-pdf-paths 2>/dev/null | sort)

# 3. Eltérés
ORFANI=$(comm -23 <(echo "$DISK_PDFS") <(echo "$DB_PDFS"))     # lemezen de nem DB-ben
GHOST=$(comm -13 <(echo "$DISK_PDFS") <(echo "$DB_PDFS"))      # DB-ben de nem lemezen

# 4. Jelentés a Capitano-nak (determinisztikus, nincs LLM)
if [ -n "$ORFANI$GHOST" ]; then
  msg="[@dottore -> @capitano] [REPORT] CV audit mismatch — "
  msg="${msg}orfani=$(echo "$ORFANI" | grep -c .) "
  msg="${msg}ghost=$(echo "$GHOST" | grep -c .)"
  jht-tmux-send CAPITANO "$msg"
  # Részletek naplózása
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  echo "{\"ts\":\"$ts\",\"orfani\":$(echo "$ORFANI" | jq -R . | jq -s .),\"ghost\":$(echo "$GHOST" | jq -R . | jq -s .)}" \
    >> /jht_home/logs/cv-disk-audit.jsonl
fi
```

`db_query.py cv-pdf-paths` (megvalósítandó): 1 útvonalat ír soronként
minden application-ból, ahol `cv_pdf_path IS NOT NULL`. Egy sor
szkript-barát a `comm`-nak.

## Mit csinál a Capitano a jelentéssel

Megkapja a `[REPORT] CV audit mismatch — orfani=2 ghost=0`-t. Megnyitja
a `/jht_home/logs/cv-disk-audit.jsonl`-t, elolvassa az árvákat, és mindegyikre
próbálja a heurisztikus egyeztetést:

1. `CV_<Candidato>_<position_id>_<...>.pdf` — új elnevezés bug #25 →
   kivonja a `position_id`-t, meghívja `db_update.py application <pid> --cv-pdf-path <path>`.
2. `CV_<Candidato>_<Company>.pdf` — régi elnevezés → keres draft application-t
   annál a cégnél cv_pdf_path nélkül. Ha egyet talál →
   újrakapcsolja. Ha többet talál → jelzi a felhasználónak (Sisal vs
   Leadtech vs Canonical: kétértelmű eset a 2026-05-17-ből).

A Capitano NEM töröl fájlokat (soha). Áthelyezi a `/jht_user/cv/_orphan/`-ba,
ha archiválni akar elveszítés nélkül.

## Anti-minták

- ❌ Árva automatikus újrakapcsolása `cv_pdf_path`-szal, amikor több
  draft application van ugyanannál a cégnél — kétértelműség, hagyd a
  felhasználót dönteni.
- ❌ Árva törlése: a CV-k magas kognitív ráfordításúak, archiválj
  mindig `rm` helyett.
- ❌ Az audit futtatása EMERGENZA közben: a Dottore-nak csak
  kör végi normál üzemben szabad futnia.

## Lásd még

- `cv-structure` § PDF generálás (W-03 atomic write, bug #26)
- `application-flow` 6. lépés (elnevezés position_id-vel, bug #25)
- `db-update` § Single-writer kapu (bug #21)
- `liveness-check` (ugyanabban a Dottore körben korábban végrehajtva)
