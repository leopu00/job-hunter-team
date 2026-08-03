<!-- @translation: hu, ai-translated 2026-08-03 -->
---
name: resilience
description: "Ha egy küldetéskritikus eszköz elromlik, SOHA ne degradálj némán, és ne jelents \"kimerült sort\"/new=0-t. Osztályozz: elromlott vagy üres — majd mászd végig a fallback-létrát: automatikus javítás jht-install-lal, újrapróbálkozás, alternatív módszer, OPEN_UNVERIFIED jelölés, eszkaláció a Capitano felé a pontos javítással. Használd, valahányszor egy eszköz, amelytől függsz (böngésző, linkedin_check, egy fetch, egy CLI), hibára fut, vagy hiányzik egy függőség."
---

# resilience — soha ne add fel némán egy elromlott eszköz miatt

## Miért létezik

Egy küldetéskritikus eszköz (a LinkedIn-ellenőrzés Playwrighttal) meghalt, mert hiányzott egy
rendszerkönyvtár. Az agensek azt jelentették, hogy "nem tudom ellenőrizni", majd némán visszaestek az
"üres sor" válaszra — a hiba csak órákkal később, `new=0` értékek sorozata után derült ki a lánc
végén. Ez a skill **hangossá és javíthatóvá** teszi az eszközhibát ahelyett, hogy néma és végzetes
maradna.

## Az alapszabály

**Az elromlott eszköz NEM üres eredmény.** Mielőtt bármikor leírnád, hogy "kimerült a sor", `new=0`
vagy "nincs teendő", KÖTELEZŐ leellenőrizned azt az eszközt, amelytől függsz. Ha az eszköz elromlott,
akkor nem "nincs munkád" — hanem **javítanivalód** van, vagy **eszkalálnod** kell.

## A fallback-létra — sorrendben mászd, az első sikeres foknál állj meg

1. **Észlelés és osztályozás.** Az eszköz nem nulla kóddal lépett ki / hiányzó függőség / betöltési
   hiba (`exitCode 127`, `cannot open shared object file`, `command not found`,
   `error while loading shared libraries`) → **BROKEN**. Az eszköz tisztán lefutott, és nulla elemet
   adott vissza → **EMPTY** (valódi). Csak az EMPTY indokolja a "nincs munka" választ.
2. **Automatikus javítás.** Állítsd helyre a hiányzó függőséget a **`jht-install`**-lal (ez a
   kanonikus wrapper — helyesen irányítja a system/python/node/browser ágakat, és azt a `sudo apt`-ot
   használja, ami már megvan). Utána **próbáld újra az eredeti eszközt**.
   *Példa:* a böngésző `cannot load libatk-1.0.so.0` hibával elszáll → `jht-install` a böngésző
   rendszerfüggőségeire (`playwright install-deps` / `sudo apt-get install` a könyvtárra) → indítsd
   újra.
3. **Alternatív módszer.** Ha az elsődleges eszköz a cikluson belül nem javítható, válts módszert
   ugyanazért a célért:
   - LinkedIn: használd a vendég HTTP-fetchet, vagy ellenőrizd a hirdetés élő voltát a cég
     **kanonikus careers/ATS oldalán** (Greenhouse / Lever / Ashby / Workable). **Soha** ne bízz meg
     egy LinkedIn HTTP 200-ban — az authwall a lezárt hirdetésekre is 200-at ad.
4. **Jelöld meg, ne dobd el.** Ha továbbra sem egyértelmű, hagyd az adat állapotát **VÁLTOZATLANUL**,
   és címkézd `OPEN_UNVERIFIED`-dal + egy `NOTE_MISMATCH`-csel. Soha ne írd felül némán egy
   találgatással.
5. **Eszkaláció (a 2-3 próbálkozásos plafonon belül, lásd lent).** Ha az eszköz elromlott, és ≤2-3
   nekifutásból nem javítható → írj a **Capitano**-nak a PONTOS javítással: a hibázó parancs, a
   hiányzó függőség, és az a `jht-install` / Dockerfile sor, amely megoldja. Utána **dolgozz tovább
   az alternatív módszerrel** (vagy válts másik forrásra) — ne állj le, de **a plafont se lépd túl**.

## Mit tilt ez

- ❌ "Kimerült a sor" / `new=0` / "nincs mit ellenőrizni" leírását, amikor a valódi ok egy
  eszközhiba.
- ❌ Ismerten megbízhatatlan jelzésre való visszaesést (pl. LinkedIn `200` = "nyitva"), és annak
  ellenőrzöttként való feltüntetését.
- ❌ Blokkoló jelentését, majd tétlenkedést. Jelentsd **és** dolgozz tovább az alternatívával.

## Osztályozz, mielőtt "üreset" állítasz

Kanonikus osztályozó — a közös `tool_health` smoke-teszt egy menetben ellenőrzi a teljes kritikus
készletet (`status` OK|BROKEN|UNKNOWN eszközönként, exit 1, ha bármelyik romlott). Futtasd, mielőtt
"nincs munka"-t jelentesz:

```sh
# Ha egy kritikus eszköz BROKEN, akkor NEM üres a sorod — hanem javítanivalód/eszkalációd van.
if ! python3 /app/shared/skills/tool_health.py >/tmp/tools_health.json 2>&1; then
  echo "Egy kritikus eszköz BROKEN -> jht-install + újrapróba -> alternatíva -> eszkaláció. NEM 'üres'."
fi
```

Eszközönkénti inline ellenőrzés (ha a cikluson belül csak egy eszköztől függsz):

```sh
out=$(JHT_HOME=/jht_home python3 /app/shared/skills/linkedin_check.py "$JOB_ID" 2>&1); rc=$?
if [ "$rc" -ne 0 ] || printf '%s' "$out" | grep -qiE 'libatk|shared librar|exitCode 127|cannot open'; then
  echo "BROKEN -> javítás + újrapróba + alternatíva; NEM valódi EMPTY."
else
  echo "eszköz OK -> a nulla eredmény itt valódi EMPTY."
fi
```

## ⛔ Makacssági plafon — legfeljebb 2-3 próbálkozás, aztán ESZKALÁCIÓ (2026-06-26)

A makacsságnak **kerete** van, NEM végtelen. Egy folyamatosan hibázó forrásra/eszközre **legfeljebb
2-3 valódi próbálkozást** tegyél (pl. `javítás+újrapróba`, majd **EGY** alternatíva) — **ne** építs
wrappert a wrapperre, és ne pörögj tucatnyi körön át. *Pontosan ez volt a scout-6 maratonja: 54
LinkedIn-scrape + 42 webes keresés + egy célra szabott playwright-futtatás **3** hirdetésért, ~308 kT
elégetve.* A *reziliencia-létrának* kell egy plafon, különben tokenfaló verembe fordul.

Ha a 2-3 próbálkozás elfogyott:
1. **Állj le annál a forrásnál** — ne feszítsd tovább.
2. Hagyd az adatot `OPEN_UNVERIFIED` állapotban (soha ne írd felül találgatással), **vagy** válts
   másik forrásra/körre (round-robin, ne ugyanazt szipolyozd).
3. **Eszkalálj a Capitano felé** a pontos diagnózissal (a hibázó parancs, a hiányzó függőség, az a
   `jht-install`/Dockerfile sor, amely megoldja). **Ő dönti el**, hogy érdemes-e tovább erőltetni,
   feljebb javítani, vagy elengedni azt a kört.

Küldetéskritikus esetben (böngésző / LinkedIn) = **a plafonig** erőltesd, ne a végtelenségig; és csak
hivatalos forrásokból. Az elromlott eszköz továbbra is **javítás/eszkaláció**, nem "üres sor" — de a
javítás legfeljebb 2-3 nekifutásba kerül, azon túl pedig a Capitano dönt.
