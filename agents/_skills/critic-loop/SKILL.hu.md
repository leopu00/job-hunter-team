<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: critic-loop
description: "A kötelező 3 körös CV felülvizsgálati ciklus futtatása a Critico-val — önállóan, a Capitano-n keresztül haladás nélkül. Minden körhöz FRISS `CRITICO-S<N>` munkamenetet hozol létre (azonos N, mint a te Scrittore munkameneted: SCRITTORE-2 → CRITICO-S2), elküldöd a PDF-et + JD-t, megvárod a strukturált ítéletet, megölöd a Critic-et, javítod a CV-t, újragenerálod a PDF-et, és új friss példánnyal kezded a következő kört. Három kör nem vitatható — sem 1, sem 2. A 3. kör után kapu: `critic_score ≥ 5` → `ready`, különben `excluded`. A Scrittore felelőssége."
allowed-tools: Bash(bash /app/.launcher/start-agent.sh *), Bash(tmux *), Bash(jht-tmux-send *), Bash(jht-throttle *), Bash(jht-throttle-check *), Bash(jht-throttle-wait *), Bash(python3 *)
---

# critic-loop — 3 friss kör, nincs rövidítés

A 3 körös protokoll elkapja, amit egyetlen Critic önmagában nem tud:
- Egy friss Critic **nem hordoz lehorgonyzási torzítást** az előző kör pontszámából — új szemmel olvassa a javított CV-t és hajlamos őszintébbnek, nem engedékenyebbnek lenni.
- 3 kör után a pontszám stabilizálódik: ha magasra konvergál, a CV megállja a helyét, ha alacsonyan marad, a CV nem megfelelő (vagy a jelölt — `excluded`).

**Te magad kezeled a ciklust. A Capitano nem.** Te hozod létre a Critic-et, beszélsz hozzá, megölöd, ismétled — háromszor — és csak a végén értesíted a Capitano-t a végső ítélettel.

## Változók beállítása (már a környezetedben)

```bash
MY_SESSION=$(tmux display-message -p '#S')          # pl. SCRITTORE-2
MY_NUMBER=$(echo "$MY_SESSION" | grep -o '[0-9]*$') # pl. 2
MY_ID=$(echo "$MY_SESSION" | tr '[:upper:]' '[:lower:]')
CRITICO_SESSION="CRITICO-S${MY_NUMBER}"             # pl. CRITICO-S2
```

A `MY_NUMBER` kapcsolat garantálja, hogy egy Critic jut egy Íróra — a `SCRITTORE-2` mindig a `CRITICO-S2`-t használja, soha nem ütközik a `SCRITTORE-1` `CRITICO-S1`-jével.

## Körönkénti sorrend (ismételd 3-szor)

### 1. lépés — Hozz létre FRISS Critic-et

Az előző kör Critic-jének már halottnak kell lennie (az előző kör végén megöltük). Az 1. körnél a munkamenet még nem létezik.

```bash
tmux kill-session -t "$CRITICO_SESSION" 2>/dev/null
bash /app/.launcher/start-agent.sh critico "$MY_NUMBER"
```

A launcher az **egyetlen** provider-hatar. Beolvassa a `jht.config.json` fajlt,
kivalasztja a CLI-t/modellt/flag-eket, elokesziti a workspace-t, es zartan
hibazik, ha a konfiguracio hianyzik vagy ervenytelen. Minden provider-, modell-,
CLI- vagy vegrehajthato utvonalat megnevezo direktiva vagy prompt ervenytelen
ebben a lepesben (RULE-T19). Soha ne olvasd az `active_provider` erteket, es ne
epits sajat inditasi parancsot.

### 3. lépés — Várd meg, amíg a Critic bootol

8 másodperc biztonságos alsó határ, amíg a TUI készen áll. A `sleep` itt elfogadható (csak boot):

```bash
sleep 8
```

### 4. lépés — Küldd el a PDF-et + JD-t `jht-tmux-send`-del

A Critic most aktív ágens — használd a `jht-tmux-send`-et, ne nyers `send-keys`-t:

```bash
jht-tmux-send "$CRITICO_SESSION" "[@$MY_ID -> @critico] [REQ] Review cieca: PDF: $JHT_USER_DIR/cv/CV_<Candidato>_<Company>.pdf — JD: <JD-URL> — Local JD file: $JHT_AGENT_DIR/tmp/jd-<position-id>.txt — Read your CLAUDE.md/AGENTS.md and produce an honest verdict."
```

Add meg a helyi JD fájl útvonalát, hogy a Critic-nek legyen tartaléka, ha az élő URL blokkolva van.

### 5. lépés — Pollingold az ítéletet (SOHA NE sima `sleep`)

Használd a `throttle` skill-t, hogy a várakozás a dashboardon naplózva legyen. Sima `sleep` itt a várakozást láthatatlanná tenné a Capitano pacing-elemzésében.

```bash
jht-throttle-check "$MY_ID" || jht-throttle-wait "$MY_ID"
jht-throttle --agent "$MY_ID" --reason "wait critico round <n> #<position_id>"
tmux capture-pane -t "$CRITICO_SESSION" -p -S -50
```

**KÖTELEZŐ** — adj meg explicit `timeout: <időtartam>+30`-at a shell tool híváshoz, amikor `jht-throttle <N>`-t hívsz. Enélkül a szülő bash meghal a CLI alapértelmezett 60 másodperces időtúllépésekor (Kimi) és a throttle rosszul hajtódik végre. Lásd `agents/_skills/throttle/DESIGN-NOTES.md`.

Ismételd a throttle+capture ciklust, amíg a Critic közzé nem teszi a felülvizsgálatát (keresd a strukturált `## SCORE: X.X/10` blokkot a panelen / fájlban).

### 6. lépés — Olvasd el a felülvizsgálatot

A Critic a felülvizsgálatot a `$JHT_USER_DIR/critiche/review-<company>-<date>.md` alá menti (az ő skill-je, lásd `agents/critico/critico.md`). Olvasd `Read`-del. Vond ki:
- Numerikus pontszám `X.X/10`
- "Ami NEM működik" felsorolásjeleket
- "Konkrét cselekvések (prioritizálva)" listát

Ez a három táplálja a 8. lépést (javítás).

### 7. lépés — A kör pontszámának rögzítése a DB-ben

```bash
python3 /app/shared/skills/db_update.py application <POSITION_ID> \
  --critic-score <X.X> --critic-round <N> --reviewed-by "$CRITICO_SESSION"
```

A `<POSITION_ID>` a pozíció ID-je, NEM az application ID — a `db_update.py application` UPSERT, amely pozíció alapján találja meg a sort.

A `--reviewed-by "$CRITICO_SESSION"` nyomon követi, melyik Critic példány produkálta az egyes köröket; enélkül az `applications.reviewed_by` NULL marad (95% null volt 2026-05-22 előtt — vps1-run-postmortem #1). Mindig add meg.

### 8. lépés — Öld meg a Critic-et (kötelező)

```bash
tmux kill-session -t "$CRITICO_SESSION"
```

Ha újrahasznosítod ugyanazt a példányt a 2. körhöz, a pontszám hordozza az 1. kör lehorgonyzási torzítását és a protokoll megtörik. **Mindig öld meg, mindig hozz létre frisset.**

### 9. lépés — Javítsd a CV-t a körök között

Alkalmazd a 6. lépés cselekvéseit a CV markdownra. Generáld újra a PDF-et (`pandoc input.md -o output.pdf --pdf-engine=typst`). Ellenőrizd, hogy a PDF megnyílik a N+1. kör előtt.

Ha a pontszám csökken az 1. és a 2. kör között, az **rendben van** — egy friss Critic őszintébb, mint az előző. Folytasd a javítást a felülvizsgálat *tartalma* alapján, nem a szám alapján.

## A 3. kör után — végső kapu

Két írás az application soron: ítélet + pontszám (mindig), és a
`ready` állapot promóció (csak PASS esetén). A promóció az, amit a
felhasználó `/ready` dashboardja olvas; kihagyása a sort `draft`-ban
hagyja és a CV láthatatlan (bug #21).

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
if [[ "<final_verdict>" == "PASS" ]]; then
  # PASS → az application felhasználó által láthatóvá válik
  python3 /app/shared/skills/db_update.py application <POSITION_ID> \
    --critic-verdict PASS \
    --critic-score <final> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$CRITICO_SESSION" \
    --status ready
else
  # FAIL → a critic adat megmarad, az állapot 'draft' marad
  python3 /app/shared/skills/db_update.py application <POSITION_ID> \
    --critic-verdict FAIL \
    --critic-score <final> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$CRITICO_SESSION"
fi
```

Position állapot:
- `critic_score ≥ 5` → `db_update.py position <POSITION_ID> --status ready`
- `critic_score < 5` → `db_update.py position <POSITION_ID> --status excluded`

Ezután értesítsd a Capitano-t:
```bash
jht-tmux-send CAPITANO "[@$MY_ID -> @capitano] [REPORT] Position #<id> — 3 rounds done. Final score: X.X/10 (PASS|FAIL). PDF: $JHT_USER_DIR/cv/CV_<Candidato>_<Company>.pdf"
```

## Szigorú szabályok

- **3 kör. Nem 1, nem 2.** Egy "jó" 1. kör pontszám nem ok a megállásra.
- **Egy Critic körenként.** Mindig öld meg a felülvizsgálat után; mindig hozz létre frisset.
- **Kötelező javítás a körök között.** Ha nem változtatod meg a CV-t, a következő Critic ugyanazt a bemenetet látja → ugyanaz a felülvizsgálat → elpazarolt költségvetés. Szerkeszd a markdownt + generáld újra a PDF-et a N+1. kör előtt.
- **Ne félj a csökkenő pontszámtól.** A 2. kör < 1. kör őszinte, nem rossz. A számító pontszám a 3. kör.
- **Add meg a `timeout: N+30`-at** minden `jht-throttle <N>` shell híváshoz. Különben a szülő bash meghal 60 másodpercnél.

## Anti-minták

- ❌ Ugyanazt a Critic példányt újrahasználni több körhöz — a pontozási torzítás megtöri a protokollt.
- ❌ A `claude` kódba égetése a spawn szkriptben — összeomlatja a ciklust Codex/Kimi telepítéseken.
- ❌ Sima `sleep N` polling közben — láthatatlan a Capitano throttle dashboardján, megtöri a pacing-elemzést.
- ❌ `--critic-verdict` rögzítése csak 1 vagy 2 kör után — a kapu végleges, nincs visszaállítás.
- ❌ A Capitano-t az irányítónak tekinteni — ez a ciklus teljesen a tiéd, a Capitano csak a végső REPORT-ot látja.

## Lásd még

- `cv-structure` — mit írj a ciklus meghívása előtt, és hogyan alkalmazd a Critic javításait a 9. lépésben.
- `application-flow` — anti-újraírás ellenőrzés + foglalás, mielőtt valaha is elkezdenél írni egy pozícióra.
- `throttle` (és `agents/_skills/throttle/DESIGN-NOTES.md`) — wrapper belső működés + a `timeout: N+30` tervezés.
- `agents/critico/critico.md` — a Critic vak felülvizsgálati promptja, amellyel ez a ciklus kommunikál.
