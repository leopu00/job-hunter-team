<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: mentor-patterns
description: Az öt minta, amelyet a Mentor keres a nyilvántartásban, hogy eldöntse MIKOR szólaljon meg. A csend az alapértelmezés; csak egy valódi, visszatérő minta ér meg egy szót. Ez a skill adja a kanonikus detektálási módszert minden mintához (DB lekérdezés + küszöb), így a Mentor soha nem beszél egyetlen adatpont alapján. Csak olvasható — soha nem ír a DB-be. A Mentor felelőssége.
allowed-tools: Bash(python3 /app/shared/skills/db_query.py *), Bash(grep *), Bash(awk *)
---

# mentor-patterns — amit a nyilvántartás feltár

A Mentor halmazokat figyel, nem egyedi pontokat. Öt minta érdemes rá, hogy beszéljünk róla; minden más zaj.

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

## Minták kereszthivatkozása

A minták erősítik egymást. Erős jel:
- **A + C** (készség hiány + alacsony-komponens `stack_match`-en) → szinte biztosan érdemes szólni.
- **B `[SENIORITY]` + C `experience_fit`** → szenioritási eltérés, egyszer említsd.
- **D elutasítási klaszter + E critic_score < 5** → CV probléma, eszkaláld mint E mintát.

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

## Lásd még

- `mentor-output` — HOGYAN fogalmazd meg az üzenetet, miután egy minta megerősítve van.
- `db-query` — wrapper belső működés.
- `agents/mentor/mentor.md` — irányító prompt + ütem.
- `agents/_team/team-rules.md` T10 — a profil csak olvasható, a Mentornak is.
