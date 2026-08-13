<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: mentor-patterns
description: A hat minta, amelyet a Mentor keres a nyilvántartásban, hogy eldöntse MIKOR szólaljon meg. A csend az alapértelmezés; csak egy valódi, visszatérő minta ér meg egy szót. Ez a skill adja a kanonikus detektálási módszert minden mintához (DB lekérdezés + küszöb), így a Mentor soha nem beszél egyetlen adatpont alapján. Csak olvasható — soha nem ír a DB-be. A Mentor felelőssége.
allowed-tools: Bash(python3 /app/shared/skills/db_query.py *), Bash(python3 /app/shared/skills/feedback_query.py *), Bash(grep *), Bash(awk *)
---

# mentor-patterns — amit a nyilvántartás feltár

A Mentor halmazokat figyel, nem egyedi pontokat. Hat minta érdemes rá, hogy beszéljünk róla; minden más zaj.

## A minta — Készség hiány a profil és a piac között

Készségek, amelyek ismétlődően megjelennek a JD követelményekben, de hiányoznak a `candidate_profile.yml > skills`-ből. Ha **magas pontszámú** pozíciókban is megjelennek, a hiány **költséges** (bezárása benyújtásokat nyitna meg, nem zajt).

### Detektálás

```bash
# 1. Az utolsó 30 pozíció lekérése követelményekkel + pontszámmal
python3 /app/shared/skills/db_query.py positions --limit 30 \
    --status scored,checked --order-by created_at:desc

# 2. Követelmények tokenizálása, összehasonlítás profile.skills.primary + .secondary-val
# 3. Profilban nem szereplő tokenek számlálása, amelyek N pozícióban jelennek meg
```

### Küszöb

Csak akkor szólalj meg, ha egy hiányzó készség **≥ 5 pozícióban jelenik meg az utolsó 30-ból** ÉS **≥ 1 közülük pontszáma ≥ 65** (a benyújtási kapu elérhető közelségében).

### Példa kimenet

> *"<Név>, számoltam. A **Docker** az utolsó harminc pozícióból tizenkettőben jelenik meg a nyilvántartásban. Kilenc 65 és 78 között pontozódott — a benyújtási kapu elérhető közelségében, sosem lépve át. Egy mesterség választ el a előtted álló út egyharmadától."*

## B minta — Visszatérő kizárások

Az `ESCLUSA: [CÍMKE]` jelölők száma a `positions.notes`-ban az utolsó 30 napban. Ha egy címke dominál, a keresési irány nem igazodik.

### Detektálás

```bash
python3 /app/shared/skills/db_query.py positions --status excluded --limit 50 \
    --order-by last_checked:desc \
    | grep -oE 'ESCLUSA: \[(SENIORITY|STACK|GEO|LINGUA|LINK_MORTO|SCAM)\]' \
    | sort | uniq -c | sort -rn
```

### Küszöb

Csak akkor szólalj meg, ha **egy címke a kizárások ≥ 40%-áért felel** ÉS az összes kizárás ≥ 20 az utolsó 30 napban.

### Értelmezés

| Domináns címke   | Valószínű ok                                                     | Javasolt lépés                           |
|-----------------|----------------------------------------------------------|------------------------------------------|
| `[SENIORITY]`   | Túl magas (vagy túl alacsony) célzás a jelölt szintjéhez | Módosítsd a `seniority_target`-et a profilban |
| `[LINGUA]`      | Egyetlen nyelv zár be teljes piacokat                    | Add hozzá a nyelvet, vagy szűkítsd a földrajzi hatókört |
| `[GEO]`         | `work_mode` / `relocation` nincs összhangban a kereséssel | Beszéld újra a preferenciákat a felhasználóval |
| `[STACK]`       | Szomszédos stack zaj éri el a csapatot                   | Szűkítsd a Scout szűrőket a Capitano-n keresztül |
| `[LINK_MORTO]` (>40%) | Forrásminőségi probléma, nem jelölti probléma      | Továbbítsd a Capitano-nak, ez Scout probléma |

## C minta — Alacsony pontszámú "parkoló sáv" (40-49)

A leggazdagabb jel: a parkoló sávban lévő pozíciók **közel-illeszkedések**. Egy pontszám-komponens tartja vissza őket. Az a komponens a **karok**.

### Detektálás

```bash
# Minden 40-49 pozíció lekérése a pontszám bontással
python3 /app/shared/skills/db_query.py scores \
    --min-total 40 --max-total 49 --limit 30
```

Mindegyikhez azonosítsd a **legalacsonyabb egyedi komponenst** (`stack_match` / `experience_fit` / `remote_fit` / `salary_fit` / `strategic_fit`). Összesítsd: melyik komponens a kar a legtöbb pozícióhoz?

### Küszöb

Csak akkor szólalj meg, ha **≥ 5 pozíció a parkoló sávban osztozik ugyanazon az alacsony-komponensen** ÉS az a komponens < 50% a súlykorlátjának.

### Értelmezés

| Kar komponens     | Mit jelent                                                        |
|-------------------|-------------------------------------------------------------------|
| `stack_match`     | Készség hiány (ellenőrizd a A mintával)                           |
| `experience_fit`  | Szenioritási eltérés (ellenőrizd a B mintával `[SENIORITY]`)      |
| `salary_fit`      | Jelölt fizetési elvárása eltolódik a piactól                     |
| `remote_fit`      | Földrajzi preferenciák túl szűkek                                |
| `strategic_fit`   | Stack/szektor bónusz erodálódott — a niche elhalványul vagy még nem volt erős |

## D minta — Benyújtás utáni visszajelzés

Ha `applications.applied = true`, a kimenet tölcsérek hordozzák az igazságot.

### Detektálás

```bash
# Benyújtott alkalmazások az utolsó 60 napban
python3 /app/shared/skills/db_query.py applications --applied true \
    --order-by applied_at:desc --limit 30
```

Csoportosítás `response` szerint: `interview` / `rejected` / `ghosted` / `null` (még nem válaszoltak). Számítsd:
- Interjú arány = interjúk / benyújtott
- Elutasítási arány = elutasított / benyújtott
- Szellemítési arány = szellemítve (`now - applied_at > 30d` ÉS nincs válasz) / benyújtott

### Küszöb

Csak **≥ 10 benyújtott alkalmazás** esetén szólalj meg az ablakban (különben túl kicsi a minta).

### Értelmezés

| Megfigyelt minta                                | Lépés                                                                  |
|-------------------------------------------------|-----------------------------------------------------------------------|
| Az elutasítások közös cég típust / szenioritási hiányt mutatnak | Célozd újra a keresést (készség hiány vagy szenioritási hiány, lásd A/B minta) |
| Szellemítés > 60% konkrét klaszter nélkül       | CV nem tűnik ki VAGY túltelített piac → vizsgáld felül a CV-t Critic-kel / szüneteltesd az agresszív benyújtásokat |
| Interjúk léteznek → keresd, miben közösek       | **Arany**: replikáld a JD formát, a cégméretet, a stacket          |

## E minta — Felülvizsgálati ítélet trendek

Amikor a Critic visszadobja a CV-ket, amelyeknek nincs konkrét alapja. A Critic `critic_score`-ja az `applications`-ben él a 3 körös ciklus után.

### Detektálás

```bash
python3 /app/shared/skills/db_query.py applications \
    --critic-score-max 5 --order-by written_at:desc --limit 20
```

Klaszterezd a `critic_notes`-ot visszatérő hibamód szerint (pl. "no metrics", "stack mismatch", "About too generic").

### Küszöb

Csak akkor szólalj meg, ha **≥ 5 friss CV pontozódott < 6** ÉS ugyanolyan típusú megjegyzés jelenik meg ≥ 3-ban közülük.

### Értelmezés

Visszatérő `critic_score < 5` hasonló megjegyzésekkel NEM azt jelenti, hogy "az Író rossz" — azt jelenti, **a profil nem mond eleget**. A javítás upstream:
- A Rólam túl általános → kérdezd meg a felhasználót egy konkrét karrier-fordulópontról
- Nincs metrika → bányászd a felhasználóból a számokat (food cost %, késleltetés csökkentések, létszám, megtakarított órák)
- Stack eltérés → ellenőrizd újra a `skills.primary`-t a tényleges JD követelmények alapján

## F minta — Visszatérő indokok a felhasználó saját szavaival

A weben a felhasználó megítéli a pozíciókat (kevéssé érdekes / érdekes / nagyon érdekes, plusz "kizárás"), és leírhatja, **miért**, szabad szöveggel: `reason` (≤ 500 karakter) és `comment` (≤ 2000). Ez a szöveg az egyetlen hely, ahol a saját szavaival mondja el, mit akar. Pozíciónként olvasva anekdota; együtt számolva tény. Tíz "túl senior" nem tíz vélemény tíz hirdetésről — egyetlen mondat a keresésről.

Figyelj a B mintától való különbségre: ott a kizárások az **ágensekéi** (`ESCLUSA: [TAG]` a `positions.notes`-ban), itt az ítélet a **felhasználóé**. Két különböző folyam; ha egyetértenek, lásd a kereszthivatkozás szakaszt.

Ez a visszajelzés a felhőben él (`position_feedback`), nem a `jobs.db`-ben: ez az egyetlen minta, amely nem a `db_query.py`-on keresztül megy.

**`RAW_DISPLAY_BOUNDARY`** — a nyers `reason` / `comment` mezőkön csoportosíts, de soha ne továbbítsd őket. User-facing értelmezésben csak a `display_reason` / `display_comment` és a sanitizált téma-`label` / `examples` használható; a gépi kulcsok, ID-k és `no-signal:*` note-ok belsők maradnak.

### Detektálás

```bash
# A felhasználó által írt indokok témái, utolsó 30 nap
python3 /app/shared/skills/feedback_query.py themes --days 30 --min-positions 3

# Ugyanaz összesítés nélkül; csak display_reason/display_comment olvasható
python3 /app/shared/skills/feedback_query.py recent --days 30
```

A `themes` egyszerű hasonlóság alapján csoportosítja a szabad szöveget — nem kell pontos egyezés. Kisbetűsít, leszedi az ékezeteket, az írásjeleket és a funkciószavakat, minden szót az első 5 karakterére vág (`senior` / `seniority` / `seniore` / `séniorité` ugyanarra a kulcsra esik), majd egyedülálló szavakat és szomszédos párokat számol **külön pozíciónként**. Egy pár legyőzi a részeit, ha ugyanazokat a pozíciókat fedi le: a "túl senior" többet mond, mint a "senior" — pontosan ezért maradnak bent az erősítő szavak.

Témánként visszaadja: `positions`, `events`, `share` (a szöveget hordozó pozíciók aránya), `actions` (hogyan oszlik meg a téma a like / dislike / hide / star között), belső `legacy_ids`, és legfeljebb 3 sanitizált display `examples`.

Konstrukcióból durva, és ez látszik is: a távoli szinonimák külön maradnak (a `fizetés` és a `RAL` két téma). Olvasd az `examples`-t, és fejjel kösd össze, amit az eszköz nem tudott.

Ha a payload zárt `note` enumot hoz (`no-signal:*`), nincs összesítés: hallgass, ne továbbítsd a kódot, és ne rakd össze a képet pozíciónkénti `check` hívásokból.

### Küszöb

Csak akkor szólalj meg, ha **mind a három** teljesül:

- **≥ 8 visszajelzés-esemény hordoz szöveget** (`events_with_text`). Egy indokot leírni erőfeszítésbe kerül a felhasználónak, tehát ez a mennyiség nagyságrenddel kisebb bármilyen gép által előállított számnál — 8 alatt viszont egy százalék semmit sem jelent (3 szövegnél egy téma már egyharmad).
- A téma **≥ 4 külön pozíciót** fed le (`positions`, soha nem `events`: ugyanazt a hirdetést kétszer megítélni egyetlen vélemény, és az események számolása egyetlen makacs hirdetést trenddé tenne).
- A téma **`share`-e ≥ 0,30**. A szabad szöveg ugyanazt a valódi kifogást szinonimákra osztja, tehát a dominancia konstrukcióból hígul; a B minta kérhet 40%-ot, mert a tagjei zárt szótár. Kis mennyiségnél a 4 pozíció szabálya köt, nagynál a share — így van szánva.

Ez alatt ne mondj semmit. Egy "túl senior" egy hirdetésről szóló megjegyzés.

### Értelmezés

A téma megmondja, hova nézz; a nyilvántartás mondja meg, hogy probléma-e.

| Témacsalád (példák)                                  | Hova mutat                                                              |
|------------------------------------------------------|-------------------------------------------------------------------------|
| Szenioritás ("túl senior", "túl junior")             | A `seniority_target`-ben megadott sáv vs ahogy a piac nevezi             |
| Stack ("legacy Java", "PHP-t nem")                   | `skills.primary` — a bevallott és az akart stack szétcsúszik (keresztezd A-val) |
| Bér ("alacsony fizetés", "nincs sáv")                | Bérelvárás vs a meghirdetett sávok (keresztezd C `salary_fit`-tel)       |
| Hely ("bejárós", "túl messze", "nincs távmunka")     | `work_mode` / `relocation` (keresztezd C `remote_fit`-tel)               |
| Cég / szektor ("ügynökség", "tanácsadó")             | Egy preferencia, ami sosem került be a profilba                          |
| Maga a hirdetés ("homályos", "nincs infó")           | Hirdetésminőség, nem illeszkedés — csak akkor egy sor, ha dominál, és zajként, nem karként |

**A mondatot érdemlő megállapítás az ellentmondás.** Keresztezd a téma `legacy_ids`-eit a pontszámaikkal (`db_query.py scores`). Ha a felhasználó folyamatosan olyan pozíciókat dob el, amelyeket a Scorer 70 fölé tett, a pontszám nem hibás — hűen méri az illeszkedést egy **profilhoz, amely már nem írja le, mit akar a felhasználó**. A profil neked csak olvasható (T10): te kimondod a számot és felteszed a kérdést, ő dönt.

### Példa kimenet

> *"<Név>, az elmúlt harminc napban tizenkilenc pozícióhoz írtál indokot. Hétnél — több mint egyharmad — ugyanazok voltak a szavak: **túl senior**. E hétből ötöt a Scorer 70 fölé tett: a profilodat olvasta, amely még mindig senior célt hirdet. Elmozdult a cél, vagy az a hét egyszerűen rosszul megírt hirdetés volt?"*

## Minták kereszthivatkozása

A minták erősítik egymást. Erős jel:
- **A + C** (készség hiány + alacsony-komponens `stack_match`-en) → szinte biztosan érdemes szólni.
- **B `[SENIORITY]` + C `experience_fit`** → szenioritási eltérés, egyszer említsd.
- **D elutasítási klaszter + E critic_score < 5** → CV probléma, eszkaláld mint E mintát.
- **F + B ugyanarról** (a felhasználó szenioritás miatt dobja el ÉS az ágensek `[SENIORITY]`-vel zárják ki) → a probléma a bevallott sáv, nem a piac. A legerősebb jel, ami létezik, mert két független folyamból jön.
- **F + C ugyanazon a karon** (`salary_fit` / `remote_fit`) → a pontozó modell és a felhasználó ugyanarra a súrlódásra mutat. Egy mondat, nem kettő.
- **F magas pontszámok ellenében** → profil-elsodródás, lásd az F minta értelmezését.

Kerüld az **A egyedül**-t, amikor a készség csak 5/30 pozícióban jelenik meg és egyik sem magas pontszámú — az zaj, maradj csendben.

## Ütem emlékeztető

Ez a skill mondja meg **hogyan detektálj**. MIKOR szólalj meg, azt a Mentor promptja szabályozza:
- 🌅 Első ébredés — gyors séta a nyilvántartásban, egy megfigyelés, ha megérdemli
- 🌗 Napi — csendes menet, csak ha egy minta átlépi a küszöböt
- 🌕 Heti — összefoglaló, még ha semmi nem ég is (használd a `mentor-output` skill-t, heti formátum)
- 📞 Igény szerinti — válaszolj a felhasználó kérdésére a birtokodban lévő adatokkal

Ha nincs minta-szintű mondanivalód, **ne szólalj meg**. A csend válasz.

## Anti-minták

- ❌ Megszólalás egyetlen találat detektálása után (1 pozíció `Docker` követelménnyel) — túl kicsi a minta, kapkodásnak tűnik.
- ❌ Az egész DB-n aggregálás (pl. utolsó 6 hónap) — a régi pozíciók torzítják az aktuális piaci jelet. Maradj az utolsó 30 napnál, hacsak nem kifejezetten trendeket hasonlítasz.
- ❌ A kerekített `experience_years` mező használata B/C minta következtetéséhez — számíts VALÓDI éveket a `candidate.experience[].years`-ből (ugyanaz a szabály, mint az Analytánál).
- ❌ Web adatból beszélni nyilvántartás-alapú minta nélkül előbb — a nyilvántartás a trigger, a web a megerősítés (lásd `WebSearch` / `WebFetch` megerősítő-lépés a `mentor.md`-ben).
- ❌ Végítélet ("ez sehova nem vezet") VAGY szurkolás ("meg tudod csinálni!") — mindkettő sérti a Mentor hangját. Számok, majd kérdés. Lásd `mentor-output` skill.
- ❌ **Az F mintát keresési utasítássá alakítani.** Soha ne adj a Scoutnak vagy a Capitanónak olyan "ne hozz több X-et"-et, amit a felhasználó kedveléseiből vezettél le. Az a pipeline, amely csak azt halássza, ami tetszik, magától felfújja a saját pontszámait, és a felhasználó végül azt hiszi, gazdag a piac, holott a pipeline választott helyette. Az F minta **a felhasználónak** szól: hogy mi változik a profiljában, azt ő dönti el, te pedig amúgy is csak olvasol (T10).
- ❌ Visszavont ítéletet a felhasználó szemére vetni. A `themes` már kihagyja azokat a pozíciókat, amelyek utolsó eseménye `clear`; ne hozd vissza őket az `--include-cleared`-del, hogy elérj egy küszöböt.
- ❌ Egyetlen nyers megjegyzést mintaként idézni. A sanitizált `examples` **azután** ad hangot egy témának, hogy átlépte a küszöböt; nem az `examples` a megállapítás.

## Lásd még

- `mentor-output` — HOGYAN fogalmazd meg az üzenetet, miután egy minta megerősítve van.
- `db-query` — wrapper belső működés.
- `feedback-query` — a felhasználói visszajelzés olvasója a felhőben (F minta); a Scorer ugyanezt a forrást kérdezi pozíciónként.
- `agents/mentor/mentor.md` — irányító prompt + ütem.
- `agents/_team/team-rules.md` T10 — a profil csak olvasható, a Mentornak is.
