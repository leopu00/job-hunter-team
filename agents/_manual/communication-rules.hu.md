<!-- @translation: hu, ai-translated 2026-06-06 -->
# 💬 Ügynökök közötti kommunikációs szabályok

A JHT ügynökök elsősorban az **adatbázison** keresztül koordinálnak, nem tmux-szal. Az adatbázis hordozza a pipeline állandósult állapotát; a tmux a **valós idejű jelzéseknek** van fenntartva, amelyek nem várhatnak a következő polling ciklusig.

## 🗄️ Adatbázis-vezérelt koordináció (az alapértelmezett)

A pipeline átadások természetesen az adatbázison keresztül történnek — nincs szükség tmux értesítésre:

| Átadás | Mechanizmus |
|---|---|
| 🕵️ Scout → 👨‍🔬 Analyst | Az Analyst folyamatosan lekérdezi a `next-for-analista`-t; azonnal látja az új `status = new` sorokat |
| 👨‍🔬 Analyst → 👨‍💻 Scorer | A Scorer lekérdezi a `next-for-scorer`-t; felveszi a `status = checked` sorokat |
| 👨‍💻 Scorer → 👨‍🏫 Writer | A Writer lekérdezi a `next-for-scrittore`-t `score DESC` szerint rendezve; felveszi a `status = scored` ≥ 50 sorokat |
| 👨‍🏫 Writer → 👤 Felhasználó | A pozíció eléri a `status = ready` + `applications.critic_verdict = PASS` állapotot; a Captain irányítópultja megjeleníti |

**Ökölszabály**: ha a pipeline következő ügynöke az új állapotot a szabványos `next-for-X` lekérdezésével láthatja, **ne küldj tmux üzenetet**. Minden batch-nél tmux-ot küldeni zajt kelt, és fennáll a kockázata, hogy üzenetek elvesznek a foglalt paneleken.

## 📡 A tmux kizárólag valós idejű jelzésekre való

Csak akkor küldj tmux üzenetet, ha a címzettnek *most* kell cselekednie, és nem várhat a következő DB poll-ig:

| Típus | Mikor használandó | Valós idő szükséges, mert… |
|---|---|---|
| `URG` | Captain → workerek (FREEZE / throttle / kill) a Sentinel jelzésére | A rate-limit túllépés küszöbön áll — a DB polling túl lassú |
| `URG` | Sentinel → Captain valós állapotváltozáskor (csúcs, túllépés, crash) | Ugyanez |
| `FEEDBACK` | Analyst → Scout elutasítási mintázatokról (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`) | A Scoutnak a **következő** lekérdezést kell módosítania, nem egy polling ciklus után |
| `REQ` / `RES` | Interaktív kérés ügynökök között (ritka) | Szinkron válasz várható |
| `ACK` | Válasz, amely megerősíti, hogy egy `URG` fogadva és alkalmazva lett | A Captainnek tudnia kell, hogy a throttle/freeze érvénybe lépett |

## 📨 Üzenet boríték

Minden ügynökök közötti üzenet címkézett egysoros borítékot használ:

```
[@from -> @to] [TYPE] payload
```

A `TYPE` a következők egyike: `URG · FEEDBACK · REQ · RES · ACK · INFO · REPORT` — de V5-ben csak az első 5 van rutinszerűen használatban (lásd a fenti táblázatot).

## 🛠️ Küldés: `jht-tmux-send`

```bash
jht-tmux-send <PEER_SESSION> "[@me -> @peer] [URG] FREEZE"
```

⚠️ **Soha ne használj nyers `tmux send-keys`-t ügynökök közötti üzenetekhez.** A Codex és Kimi TUI-k elveszítik az Enter karaktert, ha az ugyanabban a `send-keys` hívásban érkezik, mint a szövegtörzs, ami csendes deadlockokat okoz. A wrapper atomi módon kezeli a szöveget + Entert renderelési szünettel. Skill helye: `agents/_tools/jht-tmux-send`.

## 🔇 A termelés néma — az állapotot a Capitano veszi elő

Egy worker **nullaszor** érinti a Capitanót azért, hogy haladásról számoljon be. Sem itemenként, sem a
széleken: a `[START]` / `[DONE]` bookendeket **2026-07-27-én eltávolítottuk**. Egy első indítású
csapaton mérve, ~1,5 óra előzmény: **37 üzenet érkezett a Capitanóhoz, ebből 30 (81%) tiszta státusz**
— 12 `DONE`, 8 `START`, 8 `INFO`, 2 `ACK` — szemben 3-6 olyannal, amely valóban döntést kért. Mindegyik
egy teljes körébe kerül, és az automatikus modell-szétosztással ő **Opuson** fut, míg a Scout /
Analista / Scorer **Sonneten**: a Scorer egy „kész"-e a flotta legdrágább ügynökét ébreszti fel azért,
hogy ne csináljon semmit.

A pull oldal már létezett, és jobb:

```bash
python3 /app/shared/skills/db_query.py recent-activity --minutes 60
```

Egyetlen hívás megadja az ügynökönkénti számokat, plusz minden átmenetet timestamppel, aktorral,
pozícióval és indokkal — `#22 checked→scored`, `#27 new→excluded — [DEAD_LINK]`. **Egy `DONE` kevesebb
információt hordoz, mint a sor, amely létrehozta.**

### ⚠️ Mi marad PUSH — az aszimmetria a lényeg

A `recent-activity` azt mutatja, **ki termel**, tehát egy megállt ügynök **eltűnik a listából**
ahelyett, hogy kitűnne: a Capitano oldaláról a hallgatásod és a munkád azonos. Ezt a hármat ezért
továbbra is **azonnal** el kell küldeni, mert **nem hagynak nyomot a DB-ben**:

| Jelzés | Mikor |
|---|---|
| **BLOKKOLT** | abbahagytad a termelést: elromlott eszköz a `resilience` létra után, `403` / `LOCKED`, tényleg kiszáradt források (`[SCOUT-ESAUSTO]`), egy sorban álló elem, amit sem feldolgozni, sem átugrani nem tudsz |
| **Konfliktus** | két kolléga ugyanazon a rekordon / területen, és egymás közt nem tudjátok lezárni |
| **Döntéskérés** | egy `REQ`, amire csak a Capitano tud válaszolni (taxonómia-döntés, skálázás, felhasználó felé menő választás) |

Minden más — kezdés, haladás, befejezés — pull. **Ha megállsz és nem szólsz, senki nem veszi észre.**

## ⏰ Szerepkörönként kötelező jelzések

Mit KELL minden szerepkörnek tmux-on küldenie (minden más adatbázis-vezérelt):

### 🕵️ Scout
- `FEEDBACK`-et kap az Analystoktól → lekérdezések módosítása; válaszol `ACK`

### 👨‍🔬 Analyst
- `FEEDBACK`-et küld egy Scoutnak, ha:
  - 3 egymást követő kizárás ugyanarról a forrásról ugyanazzal a címkével, VAGY
  - >60% kizárási arány egyetlen Scout batch-ében

### 👨‍💻 Scorer
- *(nincs tmux — a pipeline átadások adatbázis-vezéreltek; a pontszám-eloszlási betekintések a Captain irányítópultján jelennek meg)*

### 👨‍🏫 Writer
- `URG FREEZE`-t kap a Captaintől → befejezi az aktuális Critic kört (soha ne hagyj el egy review-t félúton), majd `ACK` és alvás, amíg a throttle vissza nem tér T0/T1-re

### 💂 Sentinel
- Élvezérelt: csak akkor szólal meg, ha az állapot ténylegesen változik (használati csúcs, projekció túllépés, ügynök crash). `URG`-t küld a Captainnek a javasolt akcióval (throttle / freeze / kill). Soha nem küld közvetlenül a workereknek — a Captain a kapu.

### 👨‍✈️ Captain
- `URG` parancsokat küld a workereknek (FREEZE, throttle szint, kill) a Sentinel jelzésére
- `REQ`-t küld interaktív koordinációhoz (ritka)
- Továbbítja a felhasználói visszajelzést az 5. Fázisból a megfelelő szerepkörnek
- A pipeline állapotát az adatbázisból olvassa, nem a worker panelekből — soha nem kérdőjelezi meg egy ügynököt a tmux-ához csatlakozva

## 📥 Társak üzeneteinek olvasása

Nem kell tmux-ot ellenőrizned *minden* művelet előtt — a koordináció nagy része az adatbázison keresztül folyik. Ehelyett:

- **Munkaegységek között** (miután befejezted egy pozíciót, mielőtt a következőt felvennéd), csinálj egy gyors `tmux capture-pane -p -S -20`-at a saját session-ödön.
- **Priorizáld az `URG` és `FEEDBACK` üzeneteket**: cselekedj rajtuk, mielőtt új munkát vennél fel.
- Egy bejövő üzenet, ami egy feladat közepén érkezik, már a kontextusodban lesz (a wrapper beírja a paneledbe); nem kell pollingnod, csak vedd észre a következő iteráció előtt.

## ⏸️ Throttle: nyomon követett szünetek

Amikor le akarod lassítani a ciklusodat, hogy tartsd a rate budget-et
(lehűlés egy batch után, `URG` utáni freeze, "várakozás az upstream-re", …),
**használd a `throttle` skillt, soha ne sima `sleep`-et**:

```bash
jht-throttle <seconds> --agent <your-name> [--reason "..."]
```

Minden hívás egy eseményt fűz a `$JHT_HOME/logs/throttle-events.jsonl`-hez,
így a Captain és az irányítópult láthatja, ki szünetel és mennyi
ideig. A sima `sleep` csak nagyon rövid várakozásokra (≤ 5 s) engedélyezett
újrapróbálkozások között, ahol a naplózás zaj lenne.

Captain: amikor utasítasz egy workert a lassításra, nevezd meg a skillt kifejezetten,
pl. `[URG] Throttle: jht-throttle 180 --agent scout-1 --reason "rate budget"`.
Ne mondd azt, hogy "sleep 3 minutes" — az megkerüli a naplózást.

Lásd: [`../_skills/throttle/SKILL.md`](../_skills/throttle/SKILL.md).

## 🔗 Kapcsolódó

- 🛡️ [`anti-collision.md`](anti-collision.md) — zárolási mechanizmusok (foglalás munka előtt)
- 🧭 [`../_team/architettura.md`](../_team/architettura.md) — pipeline áttekintés (ki táplálja kit)
