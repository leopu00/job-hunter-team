<!-- @translation: hu, ai-translated 2026-06-06 -->
# 🧭 Job Hunter — Csapat architektura

---

## 🧠 Hogyan vannak az agensek szintekbe sorolva

A JHT minden szerepkort **negy szint** egyikehez rendel, a legmagasabbtol a legalacsonyabbig felsorolva. A szint jelzi a modellt + a gondolkodasi erofeszites merteket, amelyet a launcher az aktiv szolgaltato CLI-jenek atad.

| Szint | Agensek | Claude | Codex | Kimi | Mit csinal |
|---|---|---|---|---|---|
| 🥇 **very smart** | 👨‍✈️ Captain | `opus-4-7` · effort `high` | `gpt-5.5` · reasoning `high` | `k2.6` · `standard` | Kritikus, visszafordithatatlan dontesek — teljes gondolkodasi melyseg |
| 🥈 **expert** | 👨‍🏫 Writer · 👨‍⚖️ Critic · 🧙‍♂️ Mentor | `opus-4-7` · effort `medium` | `gpt-5.5` · reasoning `high` | `k2.6` · `standard` | Minta-egyeztetese ismert sablonokkal (CV, vak felulvizsgalat, hezagelemzes) |
| 🥉 **smart** | 🕵️ Scout · 👨‍🔬 Analyst · 👨‍💻 Scorer · 👩‍💼 Assistant | `sonnet-4-6` · effort `high` | `gpt-5.5` · reasoning `medium` | `k2.6` · `standard` | Kutatas, scraping, pontozas, felhasznaloi chat |
| 🎖️ **medium** | 💂 Sentinel | `sonnet-4-6` · effort `medium` | `gpt-5.5` · reasoning `medium` | `k2.6` · `standard` | Konnyusulyu watchdog — if-then szabalyok, mely gondolkodas nelkul |

**Elerheto effort szintek (tervezeshez):**

- **Claude** — `low · medium · high · xhigh · max` (Opus 4.7, 2026 apr.). `xhigh`/`max` egyelore nem hasznalt — koltseg-hatekonysagi megfontolasobol.
- **Codex** — `minimal · low · medium · high · xhigh` (GPT-5.5). Alapertelmezett: `medium`.
- **Kimi** — a CLI meg nem tamogatja az effort szinteket, igy minden szint egyetlen hivasba fut ossze.

---

## 🗺️ Pipeline egy pillantasra

```
   👤 User
     │
     ▼
   👨‍✈️ Captain ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──────► Phase 5 ──► 👤 User
                  🕵️ Discover  👨‍🔬 Verify  👨‍💻 Score   👨‍🏫 👨‍⚖️ Write+Review   📲 Notify
```

Az alabbi minden egyes fazis egy specializalt agens-szerepkornek felel meg. A Captain donti el, **hany peldanyt** inditson szerepkoronkent barmely adott pillanatban — az agensek szama dinamikus, nem az architekturaba kodolt.

---

## 1️⃣ Phase 1 — Discovery 🔍 🕵️

```
        👤 candidate_profile.yml ──┐
                                    │ circles, filters, work_mode
                                    ▼
        ┌──────────────────────────────────────┐
        │ 🕵️ Scout pool                       │
        │ N instances · Captain-managed         │
        │ peer-coordinated (no overlap on       │
        │ circles / sources / URLs)             │
        └────────────────────┬─────────────────┘
                             │ INSERT positions  (status = new)
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │ ──► Phase 2
                       └──────────────┘
                             ▲
                             │ [FEEDBACK]
                             │ (rejection patterns:
                             │  SENIORITY · STACK · GEO · LINGUA)
                             └── from 👨‍🔬 Analyst / 👨‍💻 Scorer
```

**Mit csinalnak a Scoutok.** Allasajanlatok gyujtese job boardokrol es ATS-ekrol, deduplikalas a `jobs.db` ellen, es uj poziciok irasa `status = new` megjeloelessel. Megallnak, amikor a Captain utasitja oket.

### 🤝 Multi-scout koordinacio

Tobb Scout fut parhuzamosan anelkul, hogy valaha ugyanazt a hirdetest ketszer lekerne:

- 🗺️ **Particionulas bootolaskor** — a peerek felderitik egymast a `tmux list-sessions` segitsegevel, majd teruletet egyeztetnek a `scout_coord.py` altal (mely **circles** es **sources** kie).
- 🎯 **Circles** — koncentrikus hatokoerok, belulorol kifele meritve: ① elsodleges preferencia → ② foldrajzi szomszedok → ③ celzott athelyezes → ④ szatellit → ⑤ hatar (szomszedos szerepkoeroek).
- 📚 **Source tiers** — sorrendben meritve: LinkedIn → ATS aggregatorok (Greenhouse/Lever/Indeed/Wellfound) → niche boardok (PyJobs, RemoteOK, regionalis) → WebSearch + karrieroldalak.
- ⚖️ **Anti-bias** — ha egy batch pozicioianak tobb mint 30%-a ugyanattol a munkadotol szarmazik, a Scout forras/query-t valt a kovetkezo batchhez. Enelkul egy scaleup, amely 12 poziciot tesz koeezze egyetlen boardon, elarasztana a poolt, kiszoritva a sokfeleseg.
- 🛡️ **Anti-collision** — deduplikalasi ellenoeorzes a `positions.url`-en minden `INSERT` eloett ([`anti-collision.md`](../_manual/anti-collision.md)).

### 🔁 Visszajelzes meghallgatasa

A Scoutok `[FEEDBACK]` uzeneteket kapnak az Analyst-oktol (es koezvetetten a Scorer-ektol a Captainon keresztul), `[SENIORITY] · [STACK] · [GEO] · [LINGUA]` ciimkezzessel, es a kovetkezo batchhez igazitjak a query-ket/forraso-kat. A rendszerszintu torzitasok a Captainhoz kerulnek eszkalasra.

### 🛠️ Skills

Elerheto az `/app/shared/skills/` alatt:

- **`scout_coord.py`** — terulet-particionulas bootolaskor (melyik Scout melyik circle/source tulajdonosa); a tulajdonjog egyeztetesere es a hozzarendeles ellenoerzesere hasznalja.
- **`db_query.py check-url`** — deduplikalasi gate. Minden insert eloett futtatva; `TROVATA`-t (kihagyas) vagy `NON TROVATA`-t (folytatas) ad vissza.
- **`db_insert.py position`** — ellenoerzott hirdetest ir a `positions`-ba. Koetelezoe mezok: title, company, URL, location, JD szoveg, koevemenyek.
- **`db_update.py position`** — mar beszurt rekordok `excluded`-kent jeloelesere szolgal, ha egy duplikatum atcsuszk. Soha nem DELETE.
- **`linkedin_check.py`** — hitelesitett LinkedIn gazdagitas (job ID-k → teljes hirdetes-metaadatok) a `fetch` MCP robots blokkjanak elkerulesevel.

### 🌐 MCP tools

- **`jobspy`** — toebb forrasos job board scraper (LinkedIn, Indeed, ZipRecruiter, Glassdoor) MCP-kent csomagolva. Gyors toemeges feldertes, normalizalt kimenet.
- **`linkedin`** — dedikalt LinkedIn MCP keresre + hirdetes lekerdesre.
- **`fetch`** — altalanos HTTP fetch ATS aggregator oldalakhoz (Greenhouse, Lever, Wellfound). ⚠️ A LinkedIn robots.txt blokolja — a Scoutok ott `curl`-re valtanak bongeszo user-agenttel.
- **`playwright`** — headless bongeszo JS-nehez karrieroldalakhoz, ahol az egyszeru `fetch` nem rendereli a DOM-ot.
- **`WebSearch`** *(built-in)* — 4. szintu fallback, ha az ATS-ek/niche boardok kimerultek.

---

## 2️⃣ Phase 2 — Verification ✅ 👨‍🔬

```
                       📦 jobs.db
                       (status = new)
                              │
                              ▼
        ┌──────────────────────────────────────┐
        │ 👨‍🔬 Analyst pool                      │
        │ N instances · Captain-managed         │
        │ peer-coordinated (last_checked        │
        │ timestamp prevents double-work)       │
        └────────────────────┬─────────────────┘
                             │ UPDATE positions
                             │   status = checked   → Phase 3
                             │   status = excluded  → 🗄️ archive
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │
                       └──────────────┘
                             │
                             │ [FEEDBACK]
                             │ (rejection patterns:
                             │  SENIORITY · STACK · GEO · LINGUA …)
                             ▼
                        🕵️ Scout pool
```

**Mit csinalnak az Analyst-ok.** `status = new` poziciokat vesznek, lekerik az elo JD-t, validaljak a linket, 5 strukturalt mezot elemeznek (`ESPERIENZA_RICHIESTA · ESPERIENZA_TIPO · LAUREA · LINGUA_RICHIESTA · SENIORITY_JD`), es vagy `checked`-re emelik, vagy `excluded`-kent jeloelik. A valos eveket a profil datumozott beegyzeseiboel szamitjak, nem a kerekitett `experience_years` mezoeboel. A jelolt **alkalmazkodonak** van kezelve — a szomszedos stackek nincsenek kizarva, a Scorer aranyos hezag-buntetest alkalmaz kesoebb.

### 🚫 Kizarasi cimkek

A kizarasi jegyzeetek igy kezdoednek: `ESCLUSA: [TAG]` — `[LINK_MORTO]` · `[SCAM]` · `[GEO]` · `[LINGUA]` · `[SENIORITY]` (`req > real+3` vagy senior/lead JD) · `[STACK]` (domenen kivuli). Bizonytalansag eseten → `checked`: a hamis negativok tobbe kerulnek, mint a hamis pozitivok.

### 🤝 Multi-analyst koordinacio

- 🕒 **`last_checked` vizjel** — az Analyst-ok kihagyjak a nemreg egy peer altal frissitett rekordokat.
- 🛡️ **Anti-collision szerzodes** — [`agents/_manual/anti-collision.md`](../_manual/anti-collision.md).

### 🔁 Visszajelzes a Scoutoknak

Ha 3 egymas utani kizaras ugyanazt a forras+ciimket erinti, vagy egy Scout batch-e meghaladja a 60%-os elutasitasi rataat, az Analyst `[FEEDBACK]`-et kuld annak a Scoutnak — specifikus (forras + ciimke + ID-k), cselekedheto (javasolt alternativa), idempotens (mintankent egy).

### 🛠️ Skills

- **`db_query.py next-for-analista`** — a kovetkezo `status=new` poziciot keri a `last_checked` vizjel figyelembevetelevel.
- **`db_query.py position <ID>`** — teljes JD + metaadatok lekerese az elemzeshez.
- **`db_update.py position <ID>`** — uj statusz iras (`checked` vagy `excluded`) + strukturalt jegyzetek.
- **`linkedin_check.py`** — hitelesitett LinkedIn ellenoerzes (aktiv / lejart / ceginformacio).

### 🌐 MCP tools

- **`fetch`** — az elo JD GET-je `-L` + bongeszo UA-val; "expired / closed-job" jelzoket detektal.
- **`playwright`** — fallback JS-nehez ATS oldalakhoz, amelyeket a `fetch` nem tud renderelni (Workable/Lever/Ashby).
- **`linkedin`** — mellozve: a LinkedIn ellenoerzesek a `linkedin_check.py`-n keresztul mennek (hitelesitett).

---

## 3️⃣ Phase 3 — Scoring 🎯 👨‍💻

```
                       📦 jobs.db
                       (status = checked)
                              │
                              ▼
        ┌──────────────────────────────────────┐
        │ 👨‍💻 Scorer pool                       │
        │ N instances · Captain-managed         │
        │ peer-coordinated (last_checked < 5min │
        │ = peer claimed → skip)                │
        └────────────────────┬─────────────────┘
                             │ INSERT scores · UPDATE positions
                             │   score ≥ 50  → status = scored   → Phase 4
                             │   score 40-49 → status = scored   (parking)
                             │   score < 40  → status = excluded → 🗄️ archive
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │
                       └──────────────┘
                             │
                             │ score distribution
                             │ (high-score zones → Scout queries)
                             ▼
                        🕵️ Scout pool  (via 👨‍✈️ Captain)
```

**Mit csinalnak a Scorer-ek.** Futtatnak egy **elo-ellenoerzest** (tapasztalati evek, helyszin, koetelezo vegzettseg "vagy azzal egyenereku" nelkul), hogy kiszurjek a nem ertekelheto poziciokat, majd 0-100 pontsz amot adnak a jelolt profiljahoz keest. `< 40` → `excluded`. `40-49` → `scored` (varakoztatas, a Captain dont kesoebb). `≥ 50` → `scored` + ertesites a Writer-eknek.

### 🧮 Pontozasi formula (0-100)

| Osszetevo | Suly | DB oszlop | Mit mer |
|---|---|---|---|
| Stack match | 35 | `stack_match` | Kert skillecek vs a jelolt stackje |
| Seniority fit | 25 | `experience_fit` | Kert evek vs a jelolt valos evei |
| Remote / location | 20 | `remote_fit` | Osszhang a profil helyszin-preferenciaival |
| Salary fit | 10 | `salary_fit` | Kiert fizetesei sav vs celerteke |
| Stack bonus | 10 | `strategic_fit` | Tech bonus (AI · cybersec · fintech, ha a jelolt eros tereueletei) |

Felulre alkalmazott bunteteesek: `−10` koetelezo vegzettseg "vagy azzal egyenereku" nelkul · `−15` koetelezo nyelv, amelyet nem beszel · `−5` homlyos JD konkret kovetelmeny nelkul.

### 🤝 Multi-scorer koordinacio

- 🕒 **`last_checked` igenyeles** — a Scorer raenyomja az idopecsetet pontozas eloett; a peerek kihagyjak az utolso 5 percben igenyelt rekordokat.
- 🛡️ **DB irasi hatar** — a Scorer `scores`-t (INSERT) es csak `positions.status`-t ir. Soha nem nyul az `applications`, `companies` vagy `positions.notes` mezokhaz (az Analyst teruelete).
- 🛡️ **Anti-collision szerzodes** — [`agents/_manual/anti-collision.md`](../_manual/anti-collision.md).

### 🔁 Visszajelzes a Scoutoknak (a Captainon keresztul)

A Scorer elo pontszam-eloszlasat (forras / szerepkoerek / geo / stack szerint) a Captain olvassa es visszacsatolja a Scoutoknak, igy a kovetkezo batchek a jelolt magas pontszamu zonaira koncentralnak.

### 🛠️ Skills

- **`db_query.py next-for-scorer`** — a kovetkezo `status=checked` poziciot keri a `last_checked` figyelembevetelevel.
- **`db_query.py position <ID>`** — teljes rekord + az Analyst strukturalt jegyzetei (a formula bemenetei).
- **`db_insert.py score`** — a reszletezest irja (5 osszeteevo + osszeg).
- **`db_update.py position <ID>`** — beallitja a `status = scored | excluded` ertreket.

### 🌐 MCP tools

- **`fetch`** — ujravalidalja a linket pontozas eloett (a hirdetesek gyorsan meghalnak — a Phase 2 lehetett mar regen).

---

## 4️⃣ Phase 4 — Writing + Review ✍️ 👨‍🏫 👨‍⚖️

```
                       📦 jobs.db
                       (status = scored, score ≥ 50)
                              │  selection: ≥70 first, then 50-69 desc
                              ▼
        ┌──────────────────────────────────────┐
        │ 👨‍🏫 Writer pool                       │
        │ N instances · Captain-managed         │
        │ peer-coordinated (status=writing      │
        │ claim prevents double-work)           │
        └────────────────────┬─────────────────┘
                             │ for each position:
                             │   3× rounds with a fresh Critic
                             ▼
        ┌──────────────────────────────────────┐
        │ 👨‍⚖️ Critic (CRITICO-S<N>)            │
        │ spawned fresh per round, killed after │
        │ blind review — no profile access      │
        └────────────────────┬─────────────────┘
                             │ critic_score 1-10
                             │ after round 3:
                             │   score ≥ 5 → status = ready    → Phase 5
                             │   score < 5 → status = excluded → 🗄️ archive
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │
                       └──────────────┘
```

**Mit csinalnak a Writer-ek.** Leveszik a `status = scored` poziciokat csoekkeno pontszam sorrendben (eloszor a ≥70, aztan az 50-69), igenyelik oket a `status = writing` beallitasaval, szemeelyre szabott CV-t generalnak (Cover Letter csak ha a JD keri), majd **3 koetelezo koert** futtatnak a Critic-kel. A koerek koezoett a Writer javitja a CV-t es ujrageneralja a PDF-et. Veg-gate: `critic_score ≥ 5` → `ready`, kuloenben `excluded`. **Zero invenzioni** — a CV minden allitasanak visszavizethetoenek kell lennie a `candidate_profile.yml`-re.

**Mit csinal a Critic.** Minden koerre ujjonan letrehozva (`CRITICO-S<N>`), megkapja a PDF eleresi utjat + JD URL-t, **vak felulvizsgalatot** vegez (nincs profil-hozzaferes — csak az eloette levo oldalt latja), strukturalt iteletet ad vissza: jegy X/10 + struktura/relevancia/hatas elemzes + koevemeny-vs-CV tablazat + priorizalt teendok. Minden felulvizsgalat utan toeroel — soha nem ujrahasznalt. A teljes 1-10 skalat hasznalja; nincsenek udvariassagi jegyek.

A Writer ↔ Critic hurok a legtobb tokent fogyaszto fazis. Mindketto az **expert** szinten ul (top modell + koezpes effort) — a feladat jol definialt, nem igenyel felderito gondolkodast.

### 🤝 Multi-writer koordinacio

- 🛡️ **`status = writing` igenyeles** — a Writer-ek megvaltoztatjak a statust iras eloett; a peerek kihagyjak a mar igenyelt rekordokat.
- 🚫 **Anti-rewriting** — ha a `critic_verdict` mar be van allitva, **abszolut kihagyas** (az itelet vegleges, nincs ujra-felulvizsgalat).
- 📡 **DB irasi hatar** — a Writer csak a `positions.status`-t es az `applications`-t erinti; soha nem a `scores`, `companies`, `positions.notes` mezoket.

### 🛑 Captain freeze

Amikor a Sentinel rate-limit teliteodest jelez, a Captain `[URG] FREEZE`-t kuld a Writer-eknek. Befejezik az aktualis koert, ha a hurok kozepen vannak (soha nem hagyjak el a Critic-et felulvizsgalat kozben), aztan alszanak, amig a throttle vissza nem ter T0/T1-re.

### 🛠️ Skills

- **`db_query.py next-for-scrittore`** — a kovetkezo poziciot keri csoekkeno pontszam sorrendben.
- **`db_update.py position`** — valtoztatja a `status = writing | ready | excluded` ertreket.
- **`db_insert.py application`** — regisztralja a palyazatot + CV/PDF eleresi utakat.
- **`db_update.py application`** — menti a `critic_score · critic_verdict · critic_round · critic_notes` ertrekeket koeronkent.
- **`pandoc`** — a CV markdownt PDF-re konvertalja a Typst motoron keresztul.

### 🌐 MCP tools

- **`fetch`** — ujravalidalja a JD linket iras eloett; a Critic ugyanezt az MCP-t hasznalja az elo JD olvasasahoz.
- **`WebFetch`** / **`WebSearch`** — fallback, ha a `fetch` nem eri el a JD-t (LinkedIn / robots.txt blokkolas).

---

## 5️⃣ Phase 5 — Notify 📲

```
                       📦 jobs.db
                       (status = ready)
                              │
                              ▼
                    👨‍✈️ Captain receives [RES]
                    from Writer (PDF + verdict)
                              │
                              ▼
                       📲 Telegram bot
                    (position · CV PDF · job link)
                              │
                              ▼
                         👤 User
                          ① reads the CV
                          ② sends feedback to 👨‍✈️ Captain
                          ③ applies manually using the link
                              │
                              ▼
                       📦 jobs.db
                       (status = applied — set by user)
```

**Mi toernik.** Amikor egy Writer lezarja a Phase 4-et `verdict = PASS` es `status = ready` allapottal, a Captain kap egy `[RES]` uzenetet a PDF-fel es az iteletet. Telegram uzenet megy a felhasznalonak a pozicio ciimevel, a ceggel, a generalt CV PDF-fel es az allas linkjevel.

**Miert teljes egeszeben kezzel toertenoe a jelontkezes.** A felhasznalo elolvassa a CV-t, maga iteli meg a megfelelest, visszajelzest kuld a Captainnek (`a hangnem nem jo` · `hianyozeik ez a tapasztalat` · `jo — jelentkezem` · ...), es **csak ezutan donti el, hogy jelentkezik-e** — a mar meglevo link hasznalataval. Ez a humaan ellenoerzesi pont szandekos: a JHT-t coachkent tartja a munkavallalo szamara, nem egy gyenge palyazatokat szoro agyukent a toborzok fele. A toborzoi oldalon a mennyiseg csak akkor ertelmes, ha a munkavallalo valasztotta.

**Statusz frissites.** Amikor a felhasznalo jelentkezik, a poziciot kezzel `status = applied`-kent jeloelik (Telegram valasz vagy a web dashboard "Jelentkeztem" gombja), `applied_via = telegram | web | manual` ertekkel. Az opcionalis `response` eletciklust (`interview` · `rejected` · `ghosted`) szinten a felhasznalo koeveti.

### 🛠️ Skills / tools

- **`.launcher/tg-bridge.py`** — Telegram bridge (Python): kimenő értesítések és bejövő felhasználói visszajelzések / státuszfrissítések, felhasználó felé néző szerepenként egy bot.
- **`positions.applied`** — DB flag, amelyet a felhasznalo valtoztat (soha nem automatikusan a csapat).

---

## 🎮 Pipeline orchesztracio

A pipeline nem egy statikus N-peldany-szerepkoeroenkeent konfiguracio: ez egy **visszajelzes-vezrelt hurok**, amelyet a Captain dinamikusan futtat az ataramlasi sebesseg, a sor melysege es a felhasznalo koltsegvetese alapjan. Az alabbi szamok szemleltetoe jelleguek, nem norativak.

### 🥾 Cold start — a toelcser feltoltese

Amikor a pipeline nullarol indul, a prioritas a downstream sorok gyors feltoltese:

```
   T=0       →  3× 🕵️ Scout                                    (flood the funnel)
   T+ a bit  →  2× 🕵️ Scout · 1× 👨‍🔬 Analyst                    (first offers to verify)
   T+ more   →  2× 🕵️ Scout · 1× 👨‍🔬 Analyst · 1× 👨‍💻 Scorer    (first verified ready to score)
```

Ha az Analyst lemarad a Scoutokhoz kepest, a Captain menet koezben egyensuelyoz: `+1 Analyst · −1 Scout`. Ugyanez a logika folytatodik downstream.

### 🔁 Visszajelzesi hurok — oenmagukat hangolo kereses

Az elso batch, amelyet minden downstream szerepkoer feldolgoz, **aranyat er** — ezek az adatok, amelyeket a downstream agens arra hasznal, hogy coachkolja az upstream-et:

- **👨‍🔬 Analyst → 🕵️ Scout** — egy jelentos elso batch utan az Analyst elutasitasi mintakat jelol (gyorsan zarao cegek, atkos boardok, olyan JD-formak, amelyek mindig megbuknak a verifikacion). A Scoutok upstream kihagyjak oket.
- **👨‍💻 Scorer → 🕵️ Scout** — amint a Scorer latott egy mintat, tudja, mely szerepkoerek/stackek/foldrajzi terueltek kapnak magas pontszamot. Visszacsatolja az eloszlast, igy a Scoutok kozelebb keresnek a magas pontsza mu zonakhoz.

Eredmeny: minden ciklussal a Scoutok jobb ajanlatokat talalnak, az Analyst-ok kevesebb jo ajanlatot utasitanak el, a Scorer-ek magasabb pontszam-eloszlasokat latnak. A csapat **onhangolo rendszerre** valik.

### 🎯 Writer aktivacios gate

A Writer + Critic hurkok a pipeline legdragabb reszei (top-tier modell, iterativ felulvizsgalat). **Valtakoznak** — a Writer var, amig a Critic felulvizsgal es forditva — igy egy Writer + Critic par nagyjaobol **egy folyamatos agensbe** kerul, nem kettoebe.

Hogy elkeruljek ezeknek a tokeneknek az elkoltesetse koezepszeru ajanlatokra, a Captain a Writer aktivalast a magas pontszamu sor melysegehez koeti:

1. Sorba allitja a poziciokat csoekkeno pontszam szerint.
2. Megvarja, amig eleg magas pontsza mu ajanlat gyulik oessze (pl. **10+ ajanlat score ≥ 75**).
3. Elinditja a Writer-eket — mindig a sorban levo legmagasabb pontszamu poziciotol indulnak.

### 💰 Koeltsegvetes-tudatos throttling

Minden peldanyszamlalo es gate kueszoebaertrek a felhasznalo havi koeltsegveteesehez es az [📡 Bridge → 💂 Sentinel](#-side-channel--usage-monitoring) oldalsatorna elo hasznaelati jelzeseehez igazodik. Az agressziv bootstrap szuekoes koeltsegvetesnel lelassul, mielott a minosegi iras megkezdoedne — jobb kihagyni nehany ajanlatot, mint elfureeszelni a koeltsegvetest a Discovery-ra es nem marad semmi a Writing-ra.

---

## 📡 Oldalsatorna — Hasznalatfigyelesek

A pipeline-on kivul. Folyamatosan fut mellette.

```
   ┌────────────┐  every tick  ┌────────────┐  notify on edge  ┌────────────┐
   │ 📡 Bridge  │ ───────────► │ 💂 Sentinel│ ───────────────► │ 👨‍✈️ Captain│
   │ (process,  │ usage + proj │ tier:      │  only on real    │            │
   │  not Claude│              │  medium    │  state changes   │            │
   │  agent)    │              │ event-     │                  │            │
   └────────────┘              │ driven     │                  └────────────┘
                               └────────────┘
```

**Bridge.** Egy nem-AI folyamat, amely lekerdezi minden agens CLI-jet az aktualis hasznalat es a tervezett kimeerules tekinteteben. Tick-et kuld a Sentinel-nek.
**Sentinel.** Edge-triggered: minden tick-et feldolgoz, de a Captain-nal *csak* akkor beszel, ha tenylegesen valtozik valami (hasznalati csucs, tervezett tullepes, agens osszeomalas).
**Captain.** Reagal — lassit, befagyasztja a csapatot, leallitja a problemas munkameneteket — a Sentinel jelzese alapjan.

---

## 🤝 Oldalsatorna — Felhasznalo-orientalt segitok

```
                        👤 User
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
       👩‍💼 Assistant  👨‍✈️ Captain   🧙‍♂️ Mentor
       platform      team commander  career coach
       copilot                       (always-on)
```

- **👩‍💼 Assistant** — `tier: smart`. A felhasznalo nem technikai kereseit a Captain szamara ertelmezheto utasitasokka forditja. Elrejti az implementacios reszleteket a felhasznaloi chatbol.
- **🧙‍♂️ Mentor** — `tier: expert`, **aktiv** (az alapok kesz, az optimalizalas folyamatban). Karriertanaecsado: elemzi a profil/eredmenyek koezti hezagot, cselekvesi tervet keszit, strategiai check-ineket vegez. Felhasznalo-orientalt, mindig aktiv, bootolaskor jon letre. Mappa: `agents/mentor/`.

---

## 🩺 Oldalsatorna — Allapot es karbantartas

A pipeline-on kivul. **Egyszer futo utemezett** agensek: a watchdog mindegyiket a sajat napi idoreseben inditja el; vegrehajtanak egy ellenoerzest, jelentenek a Captainnek, majd oenmegsemmisuelnek.

```
   ┌────────────┐  daily slot  ┌──────────────┐  report  ┌────────────┐
   │ watchdog   │ ───────────► │ 🩺 Dottore   │ ───────► │ 👨‍✈️ Captain│
   │ (scheduler)│              │ 👷‍♂️ Mantenitore│  findings │            │
   └────────────┘              └──────────────┘          └────────────┘
                                  one-shot → self-destruct
```

- **🩺 Dottore** — **agens-allapot**. Periodikus kontextus-frissites + retrospektiv: eszleli a beragadt/zombi agens-munkameneteket es ujrainditja oket friss kontextussal (a hosszu eletu, kontextust egetoe szalak csendes atviteli osszeomlast okoznak). Mappa: `agents/dottore/`.
- **👷‍♂️ Mantenitore** — **infra-allapot**. Napi karbantartasi ellenoerzes a konteneren/VPS-en: kuldetes-kritikus eszkoezeoek fueest-tesztje (browser/Playwright canary), fueggoeseg-szabvanyositas (`jht-install`), disk/RAM trend, arva GC. Egy elromlott kritikus eszkoez egy P1. Mappa: `agents/mantenitore/`.

---

## 💬 Kommunikacio

```
   ┌──────────┐   tmux send-keys    ┌──────────┐
   │ Captain  │ ◄─────────────────► │ Agents   │
   │          │   [@from -> @to]     │ (one     │
   │          │   MSG / REQ / RES /  │  tmux    │
   │          │   URG                │  session │
   └────┬─────┘                      │  each)   │
        │                            └──────────┘
        │  Telegram bot
        ▼
    📲 User
```

Az agensek koezti uzenetek cimkezett boriteket hasznalnak (`[@scout-1 -> @capitano] [REQ] ...`). Teljes protokoll: [`agents/_manual/communication-rules.md`](../_manual/communication-rules.md).

---

## 🔗 Kapcsolodo

- 📋 [`agents/_manual/`](../_manual/) — futasidoben fogyasztott operativ referenciadokumentumok (DB sema, kommunikacios protokoll, anti-collision szerzodes)
- 📜 [`docs/adr/`](../../docs/adr/) — architekturalis dontesek (tamogatott CLI-k, single-writer, subscription-only)
