<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: tmux-send
description: Uzenetet kuldi atomikusan egy masik agens tmux munkamenetebe. MINDIG hasznald ezt a skillt a SCOUT/ANALISTA/SCORER/SCRITTORE/CRITICO/SENTINELLA/CAPITANO agensekkel valo kommunikaciohoz. SOHA ne hivd meg kozvetlenul a `tmux send-keys` parancsot — az Ink-alapu TUI-k (Codex, Kimi) elveszitik az Enter karaktert.
allowed-tools: Bash(jht-tmux-send *)
---

# tmux-send — agensek kozotti uzenetkuldes

Shell wrapper helye: `/app/agents/_skills/tmux-send/jht-tmux-send` (szinten elerheto a `PATH`-on a `/usr/local/bin` symlinkjen keresztul, amely az image build soran jon letre).

## Miert letezik

Az Ink-alapu TUI-k (Codex, Kimi Code) **elveszitik az Entert**, ha az ugyanabban a `tmux send-keys` hivasban erkezik, mint az uzenet torzse. A szoveg karakterenkent kerul elkuldésre; az Ink-nek be kell fejeznie a renderelest, mielott ujabb billentyuletest fogadna. Ha meghivod a `tmux send-keys "msg" Enter` parancsot, az uzenet a partner bemeneti puffereben marad elkuldetlen → csendes holtpont az agensek kozott.

A wrapper atomikusan kezeli: begepeli a szoveget, **ujraolvassa a panelt, hogy megerositse, megjelent-e**, elkuldi az Entert, majd **ismet ujraolvassa a panelt, hogy megerositse, a kor valoban elindult**. A kezbesites nem az, hogy "begepelted": az, hogy "lattad elindulni a kort".

> ⚠️ Letezik egy masodik, alattomosabb allapot: a TUI **elfogadja a szoveget es figyelmen kivul hagyja az Entert**, a sor a composerben log, mikozben az agent orakig all. 3 nap alatt 4-szer eszlelve egyetlen VPS-en, a Kapitanyt is beleertve, amikor egy uzenet akkor erkezik, amikor a peer egy hosszu kort zar le. A wrapper most ujraprobalja az Entert, es ha a kor igy sem indul el, **`5`**-ot ad vissza ahelyett, hogy hamisan sikert jelentene.

## Hasznalat

```bash
jht-tmux-send <SESSION> "<message>"
```

## Peldak (V5)

```bash
# Captain → Scout (INFO, altalanos operativ uzenet)
jht-tmux-send SCOUT-1 "[@capitano -> @scout-1] [INFO] Start the main loop. Begin from CIRCLE 1 (Remote EU); ping after each batch of 3-5 positions."

# Captain → Writer (URG, valos ideju utasitas)
jht-tmux-send SCRITTORE-1 "[@capitano -> @scrittore-1] [URG] FREEZE — finish the current Critic round, then sleep until throttle returns to T0/T1."

# Analyst → Scout (FEEDBACK, elutasitasi mintak alapjan coaching)
jht-tmux-send SCOUT-2 "[@analista-1 -> @scout-2] [FEEDBACK] [SENIORITY] 4 of last 5 inserts from greenhouse.io require senior+ — switch source or query for the next batch."

# Sentinel → Captain (URG, allapotvaltozas)
jht-tmux-send CAPITANO "[@sentinella -> @capitano] [URG] Usage 94%, projection 102% — recommend throttle T2 + freeze Writers."

# Writer → Captain (REPORT, vegeredmeny)
jht-tmux-send CAPITANO "[@scrittore-1 -> @capitano] [REPORT] Position 42 — verdict PASS, score 7.5/10. PDF: /jht_user/.../CV.pdf"

# Worker → Captain (ACK, URG nyugtazasa)
jht-tmux-send CAPITANO "[@scrittore-1 -> @capitano] [ACK] freeze applied, sleeping."
```

## Uzenet borltek

Mindig tartsd meg a strukturalt prefixet:

```
[@<from> -> @<to>] [<TYPE>] <text>
```

Standard tipusok (lasd `agents/_manual/communication-rules.md` a teljes taxonomiaert es szerepenkenti elvarasokert):

- `BLOCKED` — worker → Capitano: **ABBAHAGYTAD a termelést**, és ez nem hagy nyomot a DB-ben (elromlott eszköz, `403`/`LOCKED`, kiszáradt források, egy elem, amit sem feldolgozni, sem átugrani nem tudsz). 2026-07-27 óta ez az EGYETLEN, ami megkülönbözteti az elakadást a néma munkától
- `URG` — valos ideju utasitas, azonnali cselekvest igenyel (FREEZE, throttle, kill)
- `FEEDBACK` — coaching a felso agenynek elutasitasi cimaval (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`)
- `REQ` / `RES` — szinkron keres/valasz agensek kozott
- `ACK` — visszajelzes egy `URG` vagy `REQ` kapcsan, amelyet meg nem tudsz kiszolgalni
- ~~`INFO` / `REPORT`~~ — **visszavonva a kollégák közötti forgalomra** (2026-07-27): a Capitanót ~1,5h alatt ébresztő 30 tiszta státusz-üzenetből 8 volt ilyen. A haladást a `db_query.py recent-activity`-ból húzod le, nem elmeséled

> 💬 A `[CHAT]` a **felhasznalo → agens** uzeneteknek van fenntartva a webes feluleten (lasd a Kapitan prompt-protokolljat). Ne hasznald agensek kozotti forgalomra.

## Kilpesi kodok

- `0` — uzenet kezbesitve **es elkuldve** (ellenorizve: a kor elindult)
- `1` — hianyzo argumentumok
- `2` — a celszessio nem letezik (ellenorizd a nevet a `tmux ls` paranccsal)
- `3` — a szoveg soha nem jelent meg es a panel nem foglalt → nem fogado TUI. **Az egyetlen kod, ami halott/beragadt allapotra utal.**
- `4` — a peer hosszu koron dolgozik a varakozasi kereten tul → **el**. Probald ujra kesobb, soha ne respawnolj.
- `5` — a szoveget elfogadta, de soha nem kuldte el ("el, de nema") → **el**. Probald ujra kesobb, soha ne respawnolj.

> Csak a `3` vezethet liveness-checkhez es respawnhoz. A `4` es az `5` egyarant azt jelenti, hogy a peer el: halalkent kezelni oket pontosan igy kezdodik a tulzott spawnolas.

## Szabalyok

- **SOHA** ne hasznald a `tmux send-keys` parancsot kozvetlenul masik agenssel valo kommunikaciora. Mindig a `jht-tmux-send`-en keresztul.
- **SOHA** ne allitsd le masik agens tmux munkamenetet (Kapitan #0 szabaly).
- Ha a `tmux ls` azt mutatja, hogy a celszessio nem letezik, **ne hozd letre** — kerdezd meg a Kapitant (vagy hasznald a `start-agent.sh`-t, ha *te vagy* a Kapitan).
- Alapertelmezetten hasznalj **DB-alapu koordinaciot** a pipeline-atadásokhoz (Scout→Analyst→Scorer→Writer); ezt a skillt csak a fent felsorolt valos ideju jelzesekhez hasznald. Lasd `agents/_manual/communication-rules.md`.
