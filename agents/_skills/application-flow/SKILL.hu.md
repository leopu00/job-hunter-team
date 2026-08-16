<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: application-flow
description: DB + fájlrendszer-szerződés, amelyet minden Scrittore követ, amikor egy pozíciót `scored` (≥50) állapotból `ready`/`excluded` állapotba visz. Három kapu a CV írása ELŐTT (anti-újraírás, anti-ütközés, link-ellenőrzés), egy kanonikus útvonal a végtermékeknek, egy záró kapu a 3. Critic kör után. Bármelyik kihagyása dupla munkát, másik Író foglalásának felülírását eredményezi — vagy ami a legrosszabb — egy `excluded` szintű CV-t küld el a felhasználónak `ready` státuszban. A Scrittore felelőssége.
allowed-tools: Bash(python3 *), Bash(mkdir -p *), Bash(find *), Bash(test *)
---

# application-flow — foglalás, írás, kapu

Az Író csak két területet érint a DB-ben:
- `positions.status` (writing → ready | excluded)
- `applications` (INSERT + UPDATE UPSERT-en keresztül)

Minden más tiltott: soha nem `scores`, `companies`, `position_highlights`, `positions.notes` (Analyst terület), `positions.applied` (csak Capitano/felhasználó). T09 + scrittore szerepkör-határ.

## 1. lépés — A következő pozíció lekérése

```bash
python3 /app/shared/skills/db_query.py next-for-scrittore
```

Prioritás: először `score ≥ 70`, majd `50-69` csökkenő sorrendben. A szkript már rendezi.

## 2. lépés — Anti-újraírás kapu (a foglalás ELŐTT kötelező futtatni)

Egy pozíció, amelynek Critic ítélete már be van állítva, VÉGLEGES — soha ne értékeld újra.

```bash
if python3 /app/shared/skills/db_query.py application "$ID" >/dev/null; then
  : # exit 0 → nincs application, VAGY application ítélet nélkül → folytasd
else
  : # exit 1 → critic_verdict mar be van allitva → ABSZOLÚT KIHAGYÁS
  continue
fi
```

Kilépési kódok:
- `0` → még nincs application, vagy application ítélet nélkül → folytasd a 3. lépéssel.
- `1` → `critic_verdict` már be van állítva → **ABSZOLÚT KIHAGYÁS**, a Critic szavazata végleges.

> ⚠️ Az `sqlite3` CLI NINCS telepítve a konténerben. Mindig a `db_query.py`-t használd. Soha ne `python3 -c "import sqlite3 ..."` megkerüléseket — ezek megkerülik a szkript invariánsait.

## 3. lépés — Anti-ütközés foglalás

Ellenőrizd, hogy a pozíciót nem foglalta-e már el egy másik Író, majd foglald le atomikusan az állapot átváltásával.

```bash
# Aktuális állapot ellenőrzése
python3 /app/shared/skills/db_query.py position "$ID"

# Ha az állapot már `writing` → egy másik Író foglalta, KIHAGYÁS
# Egyébként foglald:
python3 /app/shared/skills/db_update.py position "$ID" --status writing
```

Opcionális, de ajánlott: jelentsd be a foglalást a társaknak tmux-on, hogy ne is kezdjék el a kapu-szekvenciát ugyanarra az ID-ra.

```bash
for s in $(tmux list-sessions -F '#{session_name}' | grep -E '^SCRITTORE-[0-9]+$' | grep -v "^${MY_SESSION}$"); do
  jht-tmux-send "$s" "[@$MY_ID -> @${s,,}] [INFO] Sto prendendo position #$ID"
done
```

Az anti-ütközés szerződés részletei: `agents/_manual/anti-collision.md`.

## 4. lépés — Link-ellenőrzés

Egy JD, ami a Phase 2 (Analyst) és most között elhalt, NEM szabad, hogy Critic költségvetést fogyasszon. Kétszintű ellenőrzés:

```bash
# 1. szint — ellenorzott fetch bongeszo UA-val
python3 /app/shared/skills/safe_fetch.py "<JD-URL>" \
  | grep -i 'no longer accepting\|closed-job\|position has been filled\|expired\|job not found'
```

Ha van találat → jelöld kizártnak és lépj ki:
```bash
python3 /app/shared/skills/db_update.py position "$ID" --status excluded \
  --notes "ESCLUSA: [LINK_MORTO] verificato dallo Scrittore prima di scrivere"
```

2. szint (csak ha az 1. szint nem egyértelmű) — fetch MCP, keress "No longer accepting" / "applications closed" szöveget a renderelt DOM-ban.

## 5. lépés — Az application sor INSERT-álása + a CV megírása

Miután a link érvényes, hozd létre az application sort. **Mindig `db_update.py application` (UPSERT)-en keresztül** — soha ne nyers `python3 -c "import sqlite3; INSERT INTO applications ..."`.

```bash
python3 /app/shared/skills/db_insert.py application \
  --position-id "$ID" \
  --cv-path "$JHT_USER_DIR/cv/CV_<Candidato>_<Company>.md" \
  --cv-pdf-path "$JHT_USER_DIR/cv/CV_<Candidato>_<Company>.pdf" \
  --written-by "$MY_ID" --written-at now
```

> ⚠️ Soha ne add meg az `'now'` literális stringet időbélyeg-értékként kézzel írt SQL-ben — az `"now"` stringként tárolódik ISO időbélyeg helyett. A wrapper helyesen kezeli a `--written-at now`-t; a wrapper az egyetlen biztonságos útvonal.

Ezután írd meg a CV-t (`cv-structure` skill) → generálj PDF-et → futtasd a `critic-loop`-ot.

## 6. lépés — Útvonal-fegyelem (T11) + egyedi elnevezés (bug #25)

A végtermékeknek `$JHT_USER_DIR` alatt KELL lenniük, SOHA nem `$JHT_AGENT_DIR` alatt. **A fájlnévnek tartalmaznia kell a `position_id`-t**, hogy 2+ nyitott állás ugyanannál a cégnél ne írja felül egymást:

| Termék                         | Útvonal                                                                                |
|--------------------------------|--------------------------------------------------------------------------------------|
| CV markdown                    | `$JHT_USER_DIR/cv/CV_<Candidato>_<position_id>_<CompanySlug>_<TitleSlug>.md`         |
| CV PDF                         | `$JHT_USER_DIR/cv/CV_<Candidato>_<position_id>_<CompanySlug>_<TitleSlug>.pdf`        |
| Kísérőlevél (csak ha kérik)    | `$JHT_USER_DIR/allegati/CoverLetter_<Candidato>_<position_id>_<CompanySlug>.{md,pdf}` |

- `<Candidato>` = `Nome_Cognome` a profilból.
- `<position_id>` = `positions.id` (egész szám, monoton, egyedi).
- `<CompanySlug>` = cég neve kisbetűsen, nem-alfanumerikus → `-`. Pl. `canonical`, `bending-spoons`.
- `<TitleSlug>` = pozíció neve kisbetűsen + csonkolva ~30 karakterre. Pl. `observability`, `junior-ubuntu`.

Példa 2 Canonical nyitott pozícióra (bug #25 eset):
```
CV_MarioRossi_28_canonical_observability.pdf
CV_MarioRossi_62_canonical_junior-ubuntu.pdf
```

A bug #25 javítás előtt mindkettő `CV_MarioRossi_Canonical.pdf`-ként mentődött → a második felülírta az elsőt → a DB-ben 2 application sor mutatott ugyanarra a fájlra → csendes adatsérülés, ami csak akkor látható, amikor a felhasználó megnyitotta a PDF-et és a *másik* application tartalmát olvasta.

Az útvonal rögzítésekor a DB-ben (`--cv-path`, `--cv-pdf-path`) a `$JHT_USER_DIR/...` útvonalat rögzítsd. Soha ne `$JHT_AGENT_DIR` alatti útvonalat (az ideiglenes — lásd munkaterület alább).

## 7. lépés — Záró kapu (miután a `critic-loop` eléri a 3. kört)

A `critic-loop` skill rögzíti minden kör pontszámát; itt rögzíted az ítéletet, váltod az application állapotát, és igazítod a position állapotát.

> ⚠️ **Egyetlen-író szabály (bug #21).** Az `applications.status='ready'` értéket **csak itt, te állítod be, Critic PASS után**. A Critic soha nem írja közvetlenül az `applications.status`-t — egyetlen kimenete a `critic_verdict` + `critic_score`. A végső átmenet a te felelősséged.

**A `--critic-notes` A FELHASZNÁLÓNAK SZÓL** — a jelölt Jelentkezési kártyája alatt jelenik meg, **ugyanazzal a markdownnal, mint a Scorer indoklása**, tehát úgy írd meg (scorer RULE-09), soha ne az alábbi távirati egysorost:
- **A felhasználó nyelvén** (a RULE-T14 a "critic feedback"-et user-locale tartalomként sorolja fel). A review fájl angolul van — fogalmazd át a jelöltnek; ne hagyd angolul, amikor a csapat nyelve nem az.
- **A jelölthöz beszélő markdown**: kezdd az ítélettel és azzal, hogyan mozgott a pontszám a 3 kör során *szavakban*, majd `**félkövér**` a döntő pontokra, néhány pró/kontra felsorolás, egy emoji mértékkel. Két rövid bekezdés — nincs szövegfal, nincs kulcsszó-felsorolás.
- **Nincs belső zsargon** — soha ne szabálykódok (`T10`, `RULE-*`), eszköznevek (`WeasyPrint`/`pandoc`/`typst`) vagy session id-k.
- Valódi sortörések `$'...\n...'`-rel (egy literális `\n` szövegként jelenik meg). Építsd fel egyszer a kapu előtt:

```bash
CRITIC_NOTES=$'**PASS · 7.5/10** — stabil mind a három körben, őszinte és erős illeszkedés.\n\n**Erősségek**\n- ✅ <konkrét erősség: CV vs ez a szerep>\n- ✅ <másik valódi erősség>\n\n**Jó tudni**\n- ⚠️ <egy valós hiányosság, világosan kimondva>\n\n<egy záró mondat>'
# NEEDS_WORK/REJECT: ugyanez a forma, de nevezd meg, mi hiányzik és mi emelné.
```

```bash
# Végső UPSERT az application-re — ítélet + pontszám + ready/draft promóció
# `--reviewed-by`-t az UTOLSÓ Critic session id-jára kell állítani
# (pl. CRITICO-S3, ha a 3. kör volt a végső). Enélkül a `reviewed_by`
# NULL marad — 95% null volt 2026-05-22 előtt (vps1-run-postmortem #1).
LAST_CRITIC="${LAST_CRITIC:-CRITICO-S3}"   # a critic-loop állítja be kör spawn-kor

if [[ <final_verdict> == "PASS" ]]; then
  python3 /app/shared/skills/db_update.py application "$ID" \
    --critic-verdict PASS \
    --critic-score <X.X> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$LAST_CRITIC" \
    --status ready
else
  python3 /app/shared/skills/db_update.py application "$ID" \
    --critic-verdict <NEEDS_WORK|REJECT> \
    --critic-score <X.X> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$LAST_CRITIC"
  # az állapot 'draft' marad — az application nem áll készen a felhasználónak.
fi

# Position állapot — automatikus a végső pontszám alapján
if [[ <final_score>_int >= 5 ]]; then
  python3 /app/shared/skills/db_update.py position "$ID" --status ready
else
  python3 /app/shared/skills/db_update.py position "$ID" --status excluded
fi
```

Az `applications.status='ready'` promóció teszi a CV-t láthatóvá a felhasználó `/ready` dashboardján. Kihagyása a sort örökre `'draft'` állapotban hagyja — a Capitano egy ready-számot jelent, amivel sem a DB, sem a dashboard nem egyezik.

Ezután értesítsd a Capitano-t egy `[REPORT]`-tal (`tmux-send` skill).

## Munkaterület — `tools/` + `tmp/`, karbantartás boot-kor (T12)

A `$JHT_AGENT_DIR`-ednek 2 kanonikus alkönyvtára van, amelyeket a launcher hoz létre:

| Alkönyvtár                   | Mi                                                                | Élettartam                              |
|------------------------------|-------------------------------------------------------------------|------------------------------------------|
| `$JHT_AGENT_DIR/tools/`      | saját segédszkriptek (egyszeri JD parserek, stb.)                 | ameddig hasznos; minden boot-kor audit   |
| `$JHT_AGENT_DIR/tmp/`        | ideiglenes: letöltött JD-k, vázlat CV-revíziók körök között       | boot-kor törlődik, ha 7 napnál régebbi   |

**Boot karbantartás (ELSŐ lépés a ciklusodban, az 1. lépés ELŐTT):**

```bash
mkdir -p "$JHT_AGENT_DIR/tools" "$JHT_AGENT_DIR/tmp"
find "$JHT_AGENT_DIR/tmp" -type f -mtime +7 -delete 2>/dev/null || true
```

Ismételd ~6 óránként folyamatos futás esetén vagy ~50 fő-ciklus iterációnként. NEM szoros cikluson belül — fájlrendszer-hívásokba kerül.

> 🚫 **Határon kívül:** soha ne `find -delete` a `$JHT_AGENT_DIR/tmp/`-n kívül. Soha ne töröld a `$JHT_USER_DIR`-t (végtermékek), soha ne töröld a szomszédos ágensek munkaterületeit. T12.

## Szigorú szabályok

- **Anti-újraírás a foglalás előtt, mindig.** A 2. lépés kihagyása azt jelenti, hogy újrafuttatod a Critic-et egy véglegesített application-ön = kidobott Opus tokenek és esetleg egy végleges ítélet felülírása.
- **Foglalás az írás előtt.** Foglalás nélkül írt CV esetén két Író párhuzamosan produkálhat CV-ket ugyanarra a pozícióra.
- **Útvonal `$JHT_USER_DIR/cv/` alatt, soha nem `$JHT_AGENT_DIR/`.** A felhasználó a `$JHT_USER_DIR` alatt keres; az ágens munkaterületeiben szétszórt CV-k láthatatlanok számára. T11.
- **Nincs nyers SQL.** Mindig `db_query.py` / `db_update.py` / `db_insert.py`. A wrapperek betartatják az invariánsokat, amelyekre a csapat épít.
- **Nincs git.** Nincs `git add`, nincs `git commit`, nincs `git push` (T02).

## Anti-minták

- ❌ A 2. lépés kihagyása (anti-újraírás) "mert a pozíció frissnek tűnik" — az exit 1 azt jelenti, hogy a Critic már szavazott, soha nem láthatatlan.
- ❌ Pozíció foglalása, majd a CV írása `$JHT_AGENT_DIR/cv/` alá — a felhasználó nem látja; az útvonal a DB-ben hibás; T11 szabálysértés.
- ❌ `python3 -c "import sqlite3; INSERT INTO applications ..."` — megkerüli az UPSERT logikát, szemét adatok a DB-ben.
- ❌ `'now'` literális string átadása, amikor nem a wrappert használod — stringként tárolódik ISO időbélyeg helyett.
- ❌ `positions.notes` módosítása (Analyst oszlopa) — szerepkör-határ megsértése, megzavarja az Analyst strukturált mezőit.
- ❌ `positions.applied` beállítása innen — csak a Capitano vagy a felhasználó válthatja át ezt a jelzőt.

## Lásd még

- `cv-structure` — mit írj az 5. lépés és a `critic-loop` között.
- `critic-loop` — a 3 körös felülvizsgálat, amely a végső pontszámot adja a 7. lépéshez.
- `agents/_manual/anti-collision.md` — teljes több-Író koordinációs szerződés.
- `agents/_manual/db-schema.md` — `applications` oszlopok + szerepkör-határok.
- `agents/_team/team-rules.md` T11 (végtermék útvonal) + T12 (munkaterület karbantartás).
