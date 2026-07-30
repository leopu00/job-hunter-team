<!-- @translation: hu, ai-translated 2026-07-30 -->
# 💬 Ügynökök közötti kommunikációs szabályok — lean, alapból pull

A JHT ügynökök **pull-first** koordinálnak. Az alapértelmezés az, hogy *felderíted* a szükséges
állapotot, nem az, hogy *elkéred*. Egy tmux üzenet a **kivétel**, azoknak a dolgoknak fenntartva,
amiket egy társ tényleg nem tud magától megtalálni.

> **Miért lean.** Egy push-nehéz protokoll (státusz-broadcastok, rutin ACK-ok, „élsz még?" pingek)
> mindkét oldalon tokent éget — a küldő ír egy kört, a fogadó felébreszt egy kört a válaszhoz — és
> elvonja az ügynököket a valódi munkától. Ennek a forgalomnak a nagy része semmilyen cselekvést nem
> hordoz. Vágd ki.

## 🪜 A koordinációs hierarchia — DB → capture-pane → üzenet

Mindig a **legolcsóbb tierhez nyúlj, ami megválaszolja a kérdésedet**. Csak akkor lépj feljebb, ha az
alatta lévő tényleg nem képes rá.

| Tier | Eszköz | Mire való | Költség |
|---|---|---|---|
| **1. DB** | `db_query.py` (`next-for-*`, status, `last_checked`, flagek) | **megosztott állapot** — mi van sorban, mi van lefoglalva, mi készült el, pontszámok, életciklus | a legolcsóbb, determinisztikus, race nélkül |
| **2. capture-pane** | `tmux capture-pane -p -S -N` a társ session-jén | **„mit csinál X most éppen?"** — dolgozik, egy fetch-en akadt, idle, beragadt | olcsó (nincs kör a társnál), de **racy pillanatkép** — soha ne bízz benne tartós állapotként |
| **3. tmux üzenet** | `jht-tmux-send` | **cselekvés, amit a társ nem tud felderíteni** + **biztonsági események** (lásd a lécet lent) | drága — egy kör mindkét oldalon; ez a kivétel |

**Ökölszabály:** ha a válasz a DB-ben van, kérdezd a DB-t. Ha azt kell tudnod, mit csinál egy kolléga
*ebben a pillanatban*, nézd meg a pane-jét — **ne írj neki, hogy megkérdezd**. Csak akkor írj, ha
egyik sem működik.

## 🚧 A léc egy tmux üzenethez (push)

**Csak** akkor küldj üzenetet, ha ezek egyike igaz:

1. **Valódi hand-off** — a társnak *csinálnia* kell valamit, amit sem a saját `next-for-X` ciklusából,
   sem a DB-ből nem tud felderíteni. Példák: Writer → Critico a CV review-ciklus indításához; Capitano
   → worker spawn / throttle / kill miatt; Analista → Scout `FEEDBACK`, aminek a *következő* lekérdezést
   kell alakítania.
2. **Biztonsági esemény** — `LOCKED` / `403`, halt, kill, crash, küszöbön álló rate-túllépés, amit a
   DB polling túl lassú elkapni. Kizárólag Sentinel → Capitano.
3. **Felhasználó felé** — kérés az embertől vagy válasz az embernek (külön csatorna; lásd a
   szerepkör-kézikönyveket).

### ✂️ Mi van KIVÁGVA (ne küldd)

- **Üres ACK-ok** — „megkaptam, kontextus frissítve", „ok, várok". Ha az üzenet semmilyen cselekvést
  nem igényelt, és a küldőnek nincs *szüksége* a visszaigazolásra a továbblépéshez, **ne mondj semmit**.
  (A ritka esetről lásd az `ACK`-ot lent.)
- **Státusz-broadcastok** — „@all check 10:14, sorok üresek, mindenki standby". Ez megfigyelhető: a
  sorok a DB-ben vannak, az aktivitás a pane-ekben. Ne meséld el mindenkinek. (Ember által olvasható
  observabilitáshoz a strukturált event-logba írj, ne a társak pane-jébe.)
- **„Élsz? / hol tartasz?"** — használj capture-pane-t (Tier 2). Soha ne égesd el egy társ körét azért,
  hogy olyan státuszt kérj tőle, amit meg kellene állnia megírni.
- **Újramegerősítések / ismételt parancsok** — ha már kiadtál egy parancsot, ne küldd újra minden
  tick-nél. A bridge / a mailbox egyszer kézbesíti.

## 🔇 A termelés néma — az állapotot a Capitano veszi elő

Egy worker **nullaszor** érinti a Capitanót azért, hogy haladásról számoljon be. Sem itemenként, sem a
széleken: a `[START]` / `[DONE]` bookendeket **2026-07-27-én eltávolítottuk**. Egy első indítású
csapaton mérve, ~1,5 óra előzmény: **37 üzenet érkezett a Capitanóhoz, ebből 30 (81%) tiszta státusz**
— 12 `DONE`, 8 `START`, 8 `INFO`, 2 `ACK` — szemben 3-6 olyannal, amely valóban döntést kért. Mindegyik
egy teljes körébe kerül, és az automatikus modell-szétosztással ő **Opuson** fut, míg a Scout /
Analista / Scorer **Sonneten**: a Scorer egy „kész"-e a flotta legdrágább ügynökét ébreszti fel azért,
hogy ne csináljon semmit.

A pull oldal már létezett, és lényegesen jobb:

```bash
python3 /app/shared/skills/db_query.py recent-activity --minutes 60
```

Egyetlen hívás megadja az ügynökönkénti számokat, plusz minden átmenetet timestamppel, aktorral,
pozícióval és indokkal — `#22 checked→scored`, `#27 new→excluded — [DEAD_LINK]`. **Egy `DONE` kevesebb
információt hordoz, mint a sor, amely létrehozta.** (Ugyanez a protokoll az itemenkénti áradatot már
megölte: egy Analista egy éjszaka **25-ször** ébresztette a Capitanót, pozíciónként egy pinggel. Most
a két „udvarias" bookend is eltűnt.)

### ⚠️ Mi marad PUSH — az aszimmetria a lényeg

A `recent-activity` azt mutatja, **ki termel**, tehát egy megállt ügynök **eltűnik a listából**
ahelyett, hogy kitűnne: a Capitano oldaláról a hallgatásod és a munkád azonos. Ezt a hármat ezért
továbbra is **azonnal** el kell küldeni, mert **nem hagynak nyomot a DB-ben**:

| Jelzés | Mikor |
|---|---|
| **BLOCKED** | abbahagytad a termelést: elromlott eszköz a `resilience` létra után, `403` / `LOCKED`, tényleg kiszáradt források (`[SCOUT-ESAUSTO]`), egy sorban álló elem, amit sem feldolgozni, sem átugrani nem tudsz |
| **Konfliktus** | két kolléga ugyanazon a rekordon / területen, és egymás közt nem tudjátok lezárni |
| **Döntéskérés** | egy `REQ`, amire csak a Capitano tud válaszolni (taxonómia-döntés, skálázás, felhasználó felé menő választás) |

Minden más — kezdés, haladás, befejezés — pull. Ezek a korábbiak szerint megengedettek maradnak, mert
*döntések* és nem narráció: egy `FEEDBACK` egy Scoutnak, egy biztonsági `URG`. **Ha megállsz és nem
szólsz, senki nem veszi észre.**

## 🗄️ Tier 1 — adatbázis-vezérelt koordináció (az alapértelmezett)

A pipeline átadások a DB-n keresztül folynak — **nincs szükség tmux-ra**:

| Átadás | Mechanizmus |
|---|---|
| 🕵️ Scout → 👨‍🔬 Analista | Az Analista lekérdezi a `next-for-analista`-t; látja a friss `status = new` sorokat |
| 👨‍🔬 Analista → 👨‍💻 Scorer | A Scorer lekérdezi a `next-for-scorer`-t; felveszi a `status = checked` sorokat |
| 👨‍💻 Scorer → 👨‍🏫 Writer | A Writer lekérdezi a `next-for-scrittore`-t (`score DESC`); felveszi a `status = scored` ≥ 50 sorokat |
| 👨‍🏫 Writer → 👤 Felhasználó | A pozíció eléri a `status = ready` + `applications.critic_verdict = PASS` állapotot; megjelenik az irányítópulton |

**Rekord foglalása üzenet nélkül** — a társak az [`anti-collision.md`](anti-collision.md) zárolásaival
kerülik el ugyanazt a sort: INSERT előtti dedup + circles/sources partíció a Scoutnál; `last_checked`
watermark az Analistánál/Scorernél; `status = writing` flip a Writernél. **Az első írás nyer.** Nem
jelented be, hogy „viszem a 42-es ID-t" — a foglalás *maga* a zár; a társ a DB-ből olvassa ki.

## 👀 Tier 2 — capture-pane (figyelj, ne kérdezz)

Hogy megértsd, mit csinál egy kolléga, **anélkül hogy zavarnád**:

```bash
tmux capture-pane -t <PEER_SESSION> -p -S -40
```

Keresd: a spinnert / `esc to interrupt` (él, kör közben), a csupasz shell promptot (idle / esetleg
beragadt), egy blokkolt fetch-et. Ez teljesen kiváltja az „élsz? / mi a státuszod?" üzeneteket.

⚠️ **Ez pillanatkép, nem állapot.** Elkaphatsz egy kört renderelés közben. *Élet- és
aktivitásjelre* használd, **soha** ne a megosztott állapot igazságforrásaként — az mindig a DB
(Tier 1). Az *esetleg halott* társról szóló ítélet a Dottore dolga (`liveness-check`), nem egy reflexből
olvasott pane-é.

## 📨 Tier 3 — üzenet boríték és típusok

Címkézett egysoros boríték:

```
[@from -> @to] [TYPE] payload
```

Szűkített típuskészlet (a legszűkebbet használd, ami illik):

| Típus | Mikor |
|---|---|
| `URG` | Biztonság / cselekedj most: Capitano → worker (throttle / freeze / kill); Sentinel → Capitano (túllépés, crash, LOCKED) |
| `FEEDBACK` | Analista → Scout, elutasítási mintázatok (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`), amiknek a következő lekérdezést kell alakítaniuk |
| `REQ` / `RES` | Valódi szinkron kérés, ami választ vár (ritka) — igazi hand-off, nem státusz-kérdés |
| `BLOCKED` | Worker → Capitano: **abbahagytad a termelést**, és ez nem hagy nyomot a DB-ben (elromlott eszköz, `403`/`LOCKED`, kiszáradt források, egy elem, amit sem feldolgozni, sem átugrani nem tudsz). 2026-07-27 óta ez az egyetlen jelzés, ami elválasztja a leállást a néma munkától — a `recent-activity` nem tudja megmutatni, mert egy megállt ügynök eltűnik abból a listából |

`ACK` — **csak** akkor, ha a küldőnek tényleg tudnia kell, hogy a művelet érvénybe lépett, hogy
biztonságosan haladhasson tovább (pl. a Capitanónak meg kell erősítenie, hogy egy `FREEZE` alkalmazva
lett, mielőtt skáláz). **Nem** rutinválasz. Ha egy parancsnak nincs szüksége visszaigazolásra ahhoz,
hogy biztonságos legyen, a fogadó némán alkalmazza. Az `INFO` / `REPORT` elavult a társak közötti
forgalomban: a narrációt az event-logba küldd, ne a pane-ekbe.

## 🛠️ Küldés: `jht-tmux-send`

```bash
jht-tmux-send <PEER_SESSION> "[@me -> @peer] [URG] FREEZE"
```

⚠️ **Soha nyers `tmux send-keys` ügynökök közötti üzenetekhez.** A Codex/Kimi TUI-k elveszítik az Enter
karaktert, ha az a törzzsel együtt érkezik, ami csendes deadlockot okoz. A wrapper atomi módon kezeli a
szöveget + Entert. **Busy-aware**: megvárja, amíg a társ köre befejeződik, majd kézbesít (`exit 0`);
`exit 4` = a társ él, de a budgeten túl is foglalt → **próbáld később, ne spawnolj / ne kezdj újra
gondolkodni**; `exit 3` = esetleg halott → a Dottore ítélete, nem reflex. Skill:
`agents/_skills/tmux-send/jht-tmux-send`.

**Sikertelen / foglalt küldésnél:** tedd sorba (a `bridge_mailbox`, amit a Capitano ürít), **ne** nyiss
új gondolkodási kört, hogy „elmélkedj" a hibán. Az újrapróbálás mechanikus, nem kognitív.

## ⏰ Szerepkörönként kötelező jelzések (minden más pull)

### 🕵️ Scout
- **Soha ne jelentkezz be** a Capitanónál — nincs `[START]`, nincs `[DONE]`, semmi eredményenként. Az
  INSERT-ek a jelentés; ő a `recent-activity`-ből olvassa. Push csak akkor, ha **BLOCKED vagy és már
  nem termelsz** (beleértve a `[SCOUT-ESAUSTO]`-t), vagy konfliktusban vagy egy másik Scouttal.
- `FEEDBACK`-et kap az Analistáktól → igazítsd a következő lekérdezést. **Nincs ACK**, hacsak az
  Analista nem tett fel egy `REQ`-t.

### 👨‍🔬 Analista
- **Soha ne jelentkezz be** a Capitanónál — nincs `[START]`, nincs `[DONE]`, semmi pozíciónként. A
  `checked`-re váltás a jelentés. Push csak akkor, ha **BLOCKED vagy és már nem termelsz**, vagy egy
  taxonómia-arbitrázs `REQ` miatt.
- Csak valódi mintázatra küldj `FEEDBACK`-et egy Scoutnak: 3 egymást követő kizárás ugyanazzal a
  címkével ugyanarról a forrásról, VAGY > 60 % kizárási arány egy Scout batch-ében. Egyébként csend (az
  átadást a DB viszi).

### 👨‍💻 Scorer
- **Soha ne jelentkezz be** a Capitanónál — nincs `[START]`, nincs `[DONE]`, semmi pontszámonként.
  Minden pontszám egy DB-sor, amit ő a `recent-activity`-ből húz elő. Push csak akkor, ha **BLOCKED
  vagy és már nem termelsz**. A pipeline átadás DB-vezérelt; a betekintések az irányítópulton /
  event-logban jelennek meg.

### 👨‍🏫 Writer
- **Soha ne jelentkezz be** a Capitanónál — nincs `[START]`, amikor felveszel egy CV-munkát, és nincs
  `[DONE]`, amikor `ready`-re kerül: a `writing → ready` átmenet a DB-ben van. Push csak akkor, ha
  **BLOCKED vagy és már nem termelsz** (beragadt Critico-ciklus, hiányzó profiladatok).
- `URG FREEZE`-re a Capitanótól: fejezd be az aktuális Critic kört (soha ne hagyj el egy review-t
  félúton), majd lassíts. Az `ACK` csak ide való — ez a ritka megerősítés-a-továbbhaladáshoz eset.

### 💂 Sentinel
- Élvezérelt, **kizárólag munkaidőn belül**. **Csak** valódi állapotváltozásra szólal meg (csúcs,
  túllépés, crash, `LOCKED`). Élenként egy üzenet — soha ne ismételd. Soha nem broadcastol a
  workereknek (a Capitano a kapu). Állandósult állapot → csend.

### 👨‍✈️ Capitano
- `URG` a workereknek (throttle / freeze / kill / spawn) a Sentinel jelzésére vagy megfigyelt
  pipeline-igény miatt.
- A pipeline állapotát a **DB**-ből, az ügynökök aktivitását **capture-pane**-ből olvassa — soha nem
  narrál státuszt a társaknak, soha nem küld újra már kiadott parancsot.

## 📥 Társak üzeneteinek olvasása

Nem szkenneled a tmux-ot minden művelet előtt — a koordináció nagy része a DB-ben van.
- **Munkaegységek között** (egy pozíció után, a következő felvétele előtt): egy gyors
  `tmux capture-pane -p -S -20` a **saját** session-öden, hogy észrevedd a beérkező `URG` / `FEEDBACK`-et.
- Priorizáld az `URG` / `FEEDBACK`-et; cselekedj, mielőtt új munkát vennél fel.
- Egy feladat közben érkező üzenet már a kontextusodban van (a wrapper beírta a paneledbe) — csak vedd
  észre a következő iteráció előtt.

## ⏸️ Throttle: nyomon követett szünetek

A ciklusod lassításához (lehűlés, `URG` utáni, upstream-re várás) használd a `throttle` skillt, **soha
ne sima `sleep`-et**:

```bash
jht-throttle <seconds> --agent <your-name> [--reason "..."]
```

Minden hívás naplózik a `$JHT_HOME/logs/throttle-events.jsonl`-be, így a Capitano és az irányítópult
látja, ki szünetel és mennyi ideig. Sima `sleep` csak ≤ 5 s-os újrapróbálkozási résekre. Capitano:
nevezd meg a skillt kifejezetten a parancsban (`[URG] jht-throttle 180 --agent scout-1 --reason "rate
budget"`), soha ne „sleep 3 perc".

Lásd: [`../_skills/throttle/SKILL.md`](../_skills/throttle/SKILL.md).

## 🔗 Kapcsolódó

- 🛡️ [`anti-collision.md`](anti-collision.md) — claim-before-work zárolások (hogyan koordinálj a DB-n át)
- 🧭 [`../_team/architettura.md`](../_team/architettura.md) — pipeline áttekintés (ki táplálja kit)
