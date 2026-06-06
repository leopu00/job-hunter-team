<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: cv-structure
description: A CV markdown megírása, amelyből PDF készül és a Critico felülvizsgálja. Hat rögzített szekció, max 2 oldal, minden állítás visszavezethető a `candidate_profile.yml`-re (nulla kitalálás — T10). A felsorolásjelek a "metrika félkövéren + tech zárójelben" mintát követik; a hangnem illeszkedik a JD cégtípusához (startup/vállalati/fintech); kísérőlevél csak ha a JD kifejezetten kéri. A Scrittore felelőssége. Párosítsd az `application-flow`-val (foglalás + útvonal) és a `critic-loop`-pal (felülvizsgálati iterációk).
allowed-tools: Bash(pandoc *)
---

# cv-structure — a kanonikus CV elrendezés

A kimenet a `$JHT_USER_DIR/cv/CV_<Candidato>_<Company>.md`-be kerül (majd PDF pandoc/typst-tel). Útvonal szabály: `application-flow` skill — soha ne írd a végső CV-t a `$JHT_AGENT_DIR` alá (az csak ideiglenes, T11).

`<Candidato>` = `Nome_Cognome` a profilból. `<Company>` = cég neve normalizálva PascalCase-ben, szóközök és perjelek nélkül (pl. `Acme_Corp` → `AcmeCorp`).

## A 6 szekció (rögzített sorrend, max 2 oldal)

| # | Szekció            | Hossz         | Tartalom                                                                                         |
|---|--------------------|---------------|--------------------------------------------------------------------------------------------------|
| 1 | **Fejléc**         | 4-6 sor       | Név, a JD-hez igazított pozíciócím, kontakt (email/telefon/LinkedIn/GitHub), nyelvek (CEFR)      |
| 2 | **Rólam**          | 2-3 sor       | Konkrét hitelesség. **SOHA** általános kifejezések ("szenvedélyesen érdeklődik", "eredmény-orientált") |
| 3 | **Tapasztalat**    | 4-5 alszekció | Minden al = egy tapasztalat, leképezve **egy konkrét JD követelményre**. Felsorolásjelek: metrika + tech |
| 4 | **Technikai készségek** | 1 táblázat | JD kulcsszavaknak felel meg. Csak a profilban valóban dokumentált tech.                         |
| 5 | **Tanulmányok**    | 2-4 sor       | Pontos címek a profilból. Ne mentegetőzz hiányzó diplomákért.                                    |
| 6 | **Mellékprojektek** | 0-3 alszekció | Csak ha erősítik a JD illeszkedést. Hagyd ki teljesen a szekciót, ha semmi nem illik.           |

## 1. szekció — Fejléc

```markdown
# <Név Vezetéknév>
**<JD-hez igazított pozíciócím>** · <Város, Ország>
✉️ <email> · 📱 <telefon> · 🔗 linkedin.com/in/<handle> · 💻 github.com/<handle>
🗣 <Nyelv1 (szint)>, <Nyelv2 (szint)>
```

Igazítsd a pozíciócímet: ha a JD "Backend Engineer (Python)"-t mond, azt használd, ne az általános profil célt. Maradj hiteles — soha ne állíts olyan szenioritást, amid nincs.

## 2. szekció — Rólam

2-3 sor. A felhasználó valós személy, aki valós dolgokat csinált; mutasd ezt 30-50 szóban. Tiltott kifejezések:

| ❌ Tiltott                              | ✅ Helyettesítsd ezzel                                        |
|----------------------------------------|--------------------------------------------------------------|
| "Szenvedélyesen érdeklődik <X> iránt"  | tény: "5 év produkciós <X> építés"                           |
| "Eredmény-orientált szakember"          | szám: "p95 késleltetés csökkentve 320ms → 110ms 3 szolgáltatáson" |
| "Növekedési lehetőséget keresek"        | hagyd el teljesen; maga a jelentkezés jelzi ezt               |
| "Részletekre figyelő csapatjátékos"     | adj példát vagy hagyd ki                                     |

## 3. szekció — Tapasztalat

A legnehezebb szekció. Minden alblokk **egy tapasztalat**, leképezve **egy JD követelményre**.

```markdown
### <Pozíció> @ <Cég> — <2022 Már – jelen>
- **Hidegindítási idő csökkentve 4.2s → 0.8s** a bootstrap réteg újraírásával (Python, asyncio, uvloop)
- **3 ügyféloldali adattermék szállítva** teljes stack birtoklásával (FastAPI, Postgres, dbt, Airflow)
- **2 junior backend mérnök mentorálva** az első produkciós incidenseiken keresztül
```

Felsorolásjel szabályok:
- **Metrika félkövéren** az elején (szám, %, idő, skála)
- **Tech zárójelben** a felsorolásjel végén
- **Cselekvő ige** első szóként (lásd tiltott/megengedett lista alább)
- Egy sor felsorolásjelenként. Ha túlcsordulna, túl sokat zsúfolsz bele.
- 3-5 felsorolásjel tapasztalatonként. Kevesebb = a tapasztalat vékonyan néz ki; több = zaj.

### Cselekvő igék

| ✅ Használd                                                   | ❌ Tiltott                        |
|---------------------------------------------------------------|-----------------------------------|
| Built, Architected, Shipped, Engineered, Reduced,             | learned, studied, assisted,       |
| Migrated, Designed, Owned, Mentored, Scaled, Cut              | helped, was involved in,          |
|                                                               | participated in, was responsible for |

A tiltott igék junior/bizonytalan hangot jeleznek. Használd az aktív listát akkor is, ha a pozíció junior volt — arra összpontosíts, amit *szállítottál*, nem amit *csináltál*.

## 4. szekció — Technikai készségek

Egy 2 oszlopos markdown táblázat, amely tükrözi a JD kulcsszólistáját. **Csak a profilban valóban dokumentált tech.** Olyan eszköz kitalálása, amit nem ismersz, azonnali bukás a Critic felülvizsgálatban (és valós életben toborzó szemében halálítélet).

```markdown
| Terület           | Stack                                                  |
|-------------------|--------------------------------------------------------|
| Nyelvek           | Python, Go, Bash                                       |
| Backend           | FastAPI, Django, gRPC                                  |
| Adat              | PostgreSQL, Redis, dbt, Airflow                        |
| Infra             | Docker, GitHub Actions, AWS (EC2, S3, RDS)             |
```

A kategóriáknak egyezniük kell azzal, amit a JD hangsúlyoz. Ha a JD soha nem említi az infra-t, dobd el vagy tömörítsd azt a sort.

## 5. szekció — Tanulmányok

```markdown
### <Diploma>, <Intézmény> — <Év>
<egysoros megjegyzés: GPA csak ha > 28/30 ≈ 3.5/4, szakdolgozat cím csak ha releváns a JD-hez>
```

Ha a jelöltnek nincs diplomája:
- **Ne mentegetőzz** ("jelenleg folyamatban", "önképzős diplomahelyett"). A mentegetőzés gyengeséget jelez.
- Sorolj fel releváns tanúsítványokat, bootcamp-eket, online programokat saját bejegyzésekként.
- Támaszkodj a Tapasztalat szekcióra a súly hordozásához.

## 6. szekció — Mellékprojektek (opcionális)

Csak ha egy projekt egyértelműen erősíti a JD illeszkedést. Ugyanaz a felsorolásjel minta, mint a Tapasztalatnál.

```markdown
### <Projekt neve> — <github link>
- **<metrika / eredmény>** (<tech stack>)
- Egysoros leírás arról, mit csinál és miért releváns
```

Ha semmi nem illik, **hagyd ki teljesen a szekciót**. Az üres kitöltés a tartalom hiányát jelzi.

## Hangnem cégtípus szerint (JD jelekből)

| Cégtípus | Hangnem                                         | Jelek a JD-ben                                                        |
|----------|--------------------------------------------------|-----------------------------------------------------------------------|
| Startup  | Magabiztos, tulajdonlás-hangsúlyos, közvetlen, cselekvő igék először | "fast-paced", "wear many hats", "early-stage", kis csapatméret      |
| Vállalati | Professzionális, strukturált, folyamat-tudatos   | "stakeholders", "cross-functional", nagyobb csapat, jól definiált folyamat |
| Fintech / szabályozott | Megfelelőség-tudatos, precíz, keretrendszerek idézése (PCI-DSS, SOC 2, ISO 27001) | auditok, szabályozók, megfelelőségi csapatok említése |
| Ügynökség | Sokoldalú, ügyféloldali, szélesség a mélység felett | "varied projects", "client-facing", "delivery"                       |

Ne vidd túlzásba — a hangnem szín, nem jelmez. A felsorolásjelek ténylegesek maradnak mindkét esetben.

## Kísérőlevél (csak ha a JD kéri)

Alapértelmezés: **ne írj egyet sem**. Token + időmegtakarítás. Csak akkor írd meg, ha a JD kifejezetten megemlíti ("please include a cover letter", "tell us why you want this role").

Hossz: 250-400 szó. Útvonal: `$JHT_USER_DIR/allegati/CoverLetter_<Candidato>_<Company>.{md,pdf}`.

```markdown
Nyitás (közvetlen, NEM "I am writing to express my interest"):
"I'm applying for <role> because <3-4 konkrét bizonyíték, ami megfelel a JD-nek>."

Közép (1-2 bekezdés):
- Egy konkrét múltbeli eredmény, ami illeszkedik a JD fő fájdalompontjához
- Egy dolog, amit észrevettél a cégről, ami túlmutat a landing page-ükön

Zárás:
- Egy előretekintő sor: mit csinálnál az első 90 napban
- "Happy to discuss this in more detail."
```

Tiltva kísérőlevélben:
- "I am writing to express my interest…" → erőfeszítéssel kezd és semmivel ér véget
- "Please find attached my CV…" → ez egy pályázat, persze hogy mellékelve van
- "I would be honoured…" → vállalati közhelye

## PDF generálás — motor + atomic írás + DB UPDATE (W-03, bug #26)

### Motor: `wkhtmltopdf` (NEM typst, NEM fpdf2)

Technikai döntés 2026-05-18 "CV esztétika egyszerűsítve" vizsgálat után:

- **`wkhtmltopdf 0.12.6` (Qt 5.15.8)** → hivatalos motor, már telepítve
  a konténerben. Professzionális HTML+CSS CV-ket produkál, 2 oldal, ~30 KB
  (azonos kimenet a május 16-i "szép" CV-kkel).
- ❌ **NE használd a `--pdf-engine=typst`-t**: typst nem érhető el a
  konténer pandoc 2.17-ében (pandoc 3.x kellene). Történelmi hiba
  a skill-ben, jelezve 2026-05-18.
- ❌ **NE használd a `pdf_gen.py`-t (fpdf2)** CV-khez: az csak minimalista
  tartalék 80% egyszerű eset. Felhasználónak szánt CV-knél spartai
  1 oldalas elrendezést ad, nincs CSS, nincs finom térköz.

A történelmi anti-minta: a PDF generálása közvetlenül
`$JHT_USER_DIR/cv/`-be, majd külön `db_update.py application --cv-pdf-path
...` futtatása. Ha a Sentinella megölte az Írót a két lépés között
(EMERGENZA freeze 2026-05-17 04:43), a PDF a lemezen maradt, de
a DB-ben `cv_pdf_path=NULL` volt. A Sisal 7.5/10 PASS *"megírandó CV"*-vé
vált a dashboardon a felhasználónak — láthatatlan top lehetőség.

Javítás: tempfile + méret kapu + atomic mv + egylövetű UPDATE. Ha az
UPDATE sikertelen, töröld a végleges fájlt, hogy ne hagyjunk árvát.

```bash
# A végleges fájlnév tartalmazza a position_id-t, hogy 2 nyitott állás @ ugyanaz a cég ne ütközzön (bug #25)
SRC_MD="$JHT_USER_DIR/cv/CV_${CANDIDATO}_${POSITION_ID}_${COMPANY_SLUG}_${TITLE_SLUG}.md"
FINAL_PDF="$JHT_USER_DIR/cv/CV_${CANDIDATO}_${POSITION_ID}_${COMPANY_SLUG}_${TITLE_SLUG}.pdf"
TMP_PDF="$(mktemp -t cv_${POSITION_ID}.XXXXXX.pdf)"

# ── ELŐELLENŐRZÉS ─────────────────────────────────────────────────────
# Explicit ellenőrzés, hogy a motor elérhető MIELŐTT pandoc futna.
# Enélkül, elavult skill esetén (typst ami nincs, pandoc 3.x ami
# hiányzik, …) a Scrittore végrehajtotta a parancsot, sikertelen volt, random
# tartalékot improvizált → csúnya CV-k a 2026-05-18 reggelen.
if ! command -v wkhtmltopdf >/dev/null 2>&1; then
  echo "[cv-structure] ABORT eloellenorzes: wkhtmltopdf nem elerheto."
  echo "  Elfogadhato alternativ motorok: weasyprint (pandoc --pdf-engine=weasyprint)."
  echo "  SOHA NE tartalek pdf_gen.py / fpdf2-vel CV-hez (csunya kimenet)."
  echo "  Jelentsed a problemat a Capitano-nak [REPORT]-tal es ABORT."
  exit 2
fi

# 1. Renderelés pandoc → html → wkhtmltopdf (nyertes motor, 32 KB / 2 old).
#    --metadata title=... elkerüli a wkhtmltopdf "no title element" figyelmeztetést.
pandoc "$SRC_MD" -o "$TMP_PDF" \
       --pdf-engine=wkhtmltopdf \
       --metadata title="CV $CANDIDATO"

# ── KAPU RENDERELÉS UTÁN: méret + Producer ─────────────────────────────
# KÉT kötelező ellenőrzés. EGYIK sem opcionális.
#
# A) ellenőrzés méret: < 20 KB rossz motort jelez (fpdf2 ~22 KB de 1 old
# spartai, wkhtmltopdf ≥30 KB teljes HTML+CSS-sel). 20 KB küszöb OK a
# megkülönböztetéshez.
size=$(stat -c%s "$TMP_PDF" 2>/dev/null || stat -f%z "$TMP_PDF")
if [ ! -s "$TMP_PDF" ] || [ "$size" -lt 20000 ]; then
  echo "[cv-structure] ABORT renderes utan: PDF $size B gyanús (varhatoan ≥20 KB)."
  echo "  Valoszinuleg rossz motor (fpdf2 minimalista wkhtmltopdf helyett)."
  rm -f "$TMP_PDF"
  exit 3
fi

# B) ellenőrzés Producer: wkhtmltopdf-nek kell lennie (= 'Qt 5.15.8' vagy hasonló).
# Ha 'fpdf2' / üres / '?', a motor NEM wkhtmltopdf volt — a PDF
# kijon ugyan de csunya lesz. ABORT hangosan hogy a Capitano lassa.
producer=$(python3 -c "
from pypdf import PdfReader
import sys
try:
    r = PdfReader('$TMP_PDF')
    m = r.metadata or {}
    print(m.get('/Producer', ''))
except Exception as e:
    print('?'); sys.exit(1)
" 2>/dev/null)
case "$producer" in
  *Qt*)
    : # OK, wkhtmltopdf dolgozott
    ;;
  *)
    echo "[cv-structure] ABORT renderes utan: Producer='$producer' (vart 'Qt 5.x.x')."
    echo "  A tenyleges motor NEM wkhtmltopdf volt — nem professzionalis kimenet."
    rm -f "$TMP_PDF"
    exit 4
    ;;
esac

# 3. Atomic áthelyezés + UPDATE sorozatban; visszaállítás ha az UPDATE sikertelen
mv "$TMP_PDF" "$FINAL_PDF"
if ! python3 /app/shared/skills/db_update.py application "$POSITION_ID" \
        --cv-pdf-path "$FINAL_PDF" --written-at now; then
  echo "[cv-structure] UPDATE DB sikertelen, torlom a PDF-et hogy ne maradjon arva"
  rm -f "$FINAL_PDF"
  exit 1
fi
```

Kilépési kódok:
- `0` → CV OK, DB frissítve, kész a critic-loop-ra
- `2` → előellenőrzés SIKERTELEN (motor nem elérhető) — jelezd a Capitano-nak
- `3` → renderelés utáni SIKERTELEN (méret < 20 KB, minimalista kimenet) — rossz motor
- `4` → renderelés utáni SIKERTELEN (Producer != Qt) — rossz motor
- `1` → DB UPDATE SIKERTELEN (fájl visszaállítás)

A Dottore a `cv-disk-audit` egészségügyi ellenőrzésen (bug #18) újrakapcsolja az
esetleges lemez↔DB árvákat; ráadásul most jelzi a nem-Qt Producer-ű CV-ket is
"rossz motor — újragenerálni" jelzéssel.

## Generálás előtti állapot kapu (W-04, bug #26)

Pandoc futtatása előtt ellenőrizd, hogy a pozíció még scoring-grade-e.
Néha az Analyst `excluded`-ra jelöli *azután*, hogy az Író foglalta
a pozíciót (versenyhelyzet) és az Író tovább ír — 3 CV
elpazarolva Canonical ContainerImages / K8s / Deloitte-ra a
2026-05-17 dumpokban.

```bash
status=$(python3 /app/shared/skills/db_query.py position "$POSITION_ID" --field status)
case "$status" in
  excluded|rejected)
    echo "[cv-structure] position #$POSITION_ID is $status, skipping CV generation"
    exit 0
    ;;
esac
```

## Szigorú szabályok

- **Nulla kitalálás.** Minden metrikának, tech-nek, projektnek visszavezethetőnek kell lennie a `candidate_profile.yml`-re vagy a felhasználó által megadott forrásokra. A kitalálás elbuktatja a Critic-et és a valós életben elbocsátási ok. T10.
- **Testreszabás JD-nként.** Ugyanaz a jelölt különböző CV-t kap pozíciónként: más Rólam, más Tapasztalat hangsúly, más Készségek sorrend. Az általános CV-k elbuknak a pontszám kapun.
- **Egy követelmény → egy tapasztalat blokk.** Ha a JD-nek 5 követelménye van és a Tapasztalat szekciód 2-re képez le, nem a megfelelő történetet mondod.
- **Max 2 oldal.** A toborzók átfutnak. Ha a 3. oldal létezik, vágd.

## Anti-minták

- ❌ Általános Rólam ("szenvedélyes fejlesztő erős készségekkel") — azonnali halálítélet a Critic felülvizsgálatban.
- ❌ Készség táblázat a profilban nem dokumentált tech-hel — kitalálás, T10 szabálysértés.
- ❌ Mentegetőzés hiányzó diploma / évek miatt — gyengeséget jelez.
- ❌ Ugyanaz a CV több JD-n keresztül — a pontszám kapu bünteti az általános CV-ket.
- ❌ Kísérőlevél, amikor nem kérik — elpazarolt tokenek, hosszabb felülvizsgálati ciklus, nincs érték.
- ❌ Több mint 5 felsorolásjel tapasztalatonként — a toborzók átfutnak, elveszted a vezető felsorolásjel hatását.

## Lásd még

- `application-flow` — foglalás + útvonal + UPSERT MIELŐTT egyetlen sort is írnál a CV-ből.
- `critic-loop` — a 3 körös vak felülvizsgálat, ami következik. Alkalmazd a `Konkrét cselekvések`-et a körök között.
- `agents/_team/team-rules.md` T10 (csak olvasható profil) + T11 (végtermékek a `$JHT_USER_DIR`-ben).
- `agents/scrittore/scrittore.md` — az irányító prompt, amely ezt a skill-t hívja a fő ciklusban.
