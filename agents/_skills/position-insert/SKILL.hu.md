<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: position-insert
description: "Az 5 kapus szekvencia, amelyet a Scout MINDEN jelolt poziciohoz vegrehajt, mielott INSERTelne a `positions` tablaba: dedup → link-ellenorzes → JD lekerdezes → megenged szurok → INSERT. Barmely kapu kihagyasa duplikatumokkal, halott linkekkel vagy hatalytalanul szurt sorokkal tolti meg az adatbazist, amelyeket aztan az Analistanak kell eldobnia — elpazarolt Sonnet-koltsegvetes downstream. A Scout szerephez tartozik; parja a `circles-and-sources` (meghatározza, HOL keresunk) es a `scout-coord` (meghatározza, KI hol keres)."
allowed-tools: Bash(python3 *), Bash(grep *)
---

# position-insert — 5 kapu pozicionkent

Egy poziciot csak akkor erdemes beszurni, ha mind az ot kapun atjut. A sorrend szamit: az olcsobb ellenorzesek jonnek eloszor, igy a dragabbak (teljes JD lekerdezes + szures) csak az eletkepesekre futnak le.

## Gate 1 — Dedup (olcso, kotelezo elso)

```bash
python3 /app/shared/skills/db_query.py check-url <linkedin_id_or_url>
```

- Kimenet `TROVATA` → **SKIP** (mar benne van az adatbazisban, esetleg mas statuszban — soha ne szurd be ujra).
- Kimenet `NON TROVATA` → tovabb a Gate 2-re.

A dedup-kulcs a kanonikus URL (vagy LinkedIn allasjegyzek-ID LinkedIn eseten). Ha ugyanaz a hirdetés ket kulonbozo forrasbol szarmazik (pl. ceges karrieroldal ES LinkedIn-kereszthivatkozas), a `check-url` deduplikalja.

## Gate 2 — Link-ellenorzes (HTTP + URL)

Ketlepcsos ellenorzes a halott hirdeteesek ES a csendes atiranyitasok felismeresere egy generikus `/careers` oldalra (= allas eltavolitva, de az oldal 200-at ad vissza).

### 2a lepes — statuszkod + vegleges URL

```bash
python3 /app/shared/skills/safe_fetch.py --status '<URL>'
```

| Eredmeny                                      | Teendo                                         |
|-----------------------------------------------|------------------------------------------------|
| `HTTP:404` / `HTTP:410`                       | SKIP (halott link)                             |
| `HTTP:301/302` generikus `/careers` vagy `/jobs` oldalra | SKIP (pozicio eltavolitva, generikus atiranyitas) |
| `HTTP:200/301/302` vegleges URL = hirdetes oldala | tovabb a 2b lepesre                        |

### 2b lepes — tartalmi jelek

```bash
python3 /app/shared/skills/safe_fetch.py '<URL>' \
  | grep -i 'no longer accepting\|closed-job\|position has been filled\|expired\|job not found'
```

- Talalat → SKIP (lezart allas)
- Nincs talalat → tovabb a Gate 3-ra

### Workable megjegyzes

Workable-on hosztolt ATS eseten: hirdeetesenkeent **ket** URL letezik. Hasznald a helyeset:
- `apply.workable.com/...` → jelentkezesi urlap: `302`-t ad vissza, ha az allas lezarult (halott linknek tunik, hamis pozitiv).
- `jobs.workable.com/...` → kanonikus JD-oldal: HTTP 200 + ervenyes JSON-LD, ha a pozicio aktiv.

Mindig a **kanonikus** oldalt (`jobs.workable.com`) ellenorizd, nem a jelentkezesi urlapot. Ugyanez az elv ervenyes Greenhouse, Lever, Ashby eseten.

## Gate 3 — Teljes JD lekerdezes

Az adatbazis-szerzodes megkoveteli, hogy a `--jd-text` es a `--requirements` TELJES legyen — a reszleges scrape-ek elrontjak az Analistat downstream.

```bash
# 1. szint — ellenorzott fetch bongeszo UA-val (a legtobb eset)
python3 /app/shared/skills/safe_fetch.py '<URL>' > $JHT_AGENT_DIR/tmp/jd-raw.html

# 2. szint — JS-nehez oldalak (Wellfound, egyes egyedi karrieroldalak): playwright MCP hasznalata
# 3. szint — tartalek: WebFetch / WebSearch
```

> A `safe_fetch.py` szandekosan valtja le a `curl -L`-t: **minden**
> atiranyitasi ugrast ellenoriz, es elutasitja a kontener halozatan
> beluli cimeket. Ne terj vissza a csupasz `curl`-hoz — egy hirdetes
> oldala, ami a `169.254.169.254`-re iranyit at, nem hirdetes oldala.

Nyerd ki a **teljes szovegtorzset** (nem csak a cimet) es a **kovetelmenyek reszt** (keszsegek, tapasztalati evek, nyelvek). Ha az oldalnak van egyertelmu "Requirements" / "Must have" / "What you'll bring" szekcioja, maskold le szo szerint a `--requirements`-be.

Blokkolt oldalak (NE hasznald a `fetch` MCP-t, a robots.txt blokkolja):
- `linkedin.com` → hasznald a `linkedin_check.py`-t (hitelesitett) vagy `safe_fetch.py`-t
- `wellfound.com` → hasznald a `playwright`-ot vagy a `safe_fetch.py`-t

## Gate 4 — Megenged Scout-szintu szurok

CSAK a negy teljesen-hatarkon-kivuli szurot alkalmazd (teljes tablazat a `circles-and-sources` skillben). Hagyd ki, ha:

- A cim kifejezetten tartalmazza: `senior`, `lead`, `staff`, `principal`, `head of`, `director`
- Foldrajzi munkaengedely osszeferhetetlen (`US-only` / `Canada-only` es a jeloltnek nincs vizuma)
- A domain teljesen az IT/coding-on kivul esik (es a jelolt IT-s)
- Kemeny kovetelmenye `> real_years + 3` ev tapasztalat

Minden mas: engedd at a Gate 5-re. **Ne vegezd el az Analista munkajat** — rokon stackek, majdnem-talalatok, kis resek mind `checked` anyag; a Scorer alkalmazza a res-buntetest.

## Gate 5 — INSERT

```bash
python3 /app/shared/skills/db_insert.py position \
  --title "<TITOLO>" \
  --company "<AZIENDA>" \
  --url "<URL canonica, NON apply form>" \
  --location "<location reale dalla JD>" \
  --remote-type <full_remote|hybrid|on_site> \
  --source <slug fonte: linkedin|greenhouse|lever|indeed|wellfound|remoteok|...> \
  --found-by $MY_ID \
  --jd-text "<TESTO COMPLETO DELLA JD>" \
  --requirements "<stack + requirements estratti dalla JD>"
```

**Minden flag kotelezo** — ures `--jd-text` vagy hianyzó `--url` azt jelenti, hogy az Analista nem tudja elvegezni a munkajat. A `db_insert.py` szkript erveniesiti a nem-ures ertekeket; ha elutasitja a hivasodat, javitsd a bemenetet — soha ne kerüld meg nyers SQL-lel.

## DB irasi hatar (T05 + szerep)

A Scout CSAK a kovetkezot irja:
- `positions` (INSERT, soha UPDATE, kiveve az alabb leiro dup-recovery esetet)

SOHA nem nyul hozza:
- `companies` (Analista terulet)
- `scores` (Scorer)
- `applications` (Scrittore)
- `position_highlights` (Analista)
- `status != 'new'` statuszú poziciok (mar downstream kerultek, kezeket el)

### Dup recovery (az egyetlen megengedett UPDATE)

Ha veletlen duplikatumot szurtal be (a Gate 1 tevedett, pl. egy normalizalt URL atcsuszott), megjelolheted a duplikatumot excluded-kent — de soha ne DELETE-elj:

```bash
python3 /app/shared/skills/db_update.py position <DUP_ID> --status excluded \
  --notes "DUPLICATA di #<ORIGINAL_ID>"
```

`DELETE` / `DROP` SQL tiltott (T02 + DB biztonsag). Az `excluded` megjegyzesekkel torteno visszavonasok auditalhatok; a torlesek nem.

## Az INSERT utan — Analistak ertesitese

Minden 3-5 insert batch utan pingelj az Analista munkameneteknek az ID-tartomanyt. Mindenkeppen felveszik a `status=new`-t az adatbazisbol, de a ping leroviti a kesleltetes:

```bash
jht-tmux-send ANALISTA-1 "[@$MY_ID -> @analista-1] [INFO] Batch 5 posizioni inserite (IDs: X-Y)"
```

Ha 2 Analistad van, valtogasd a ping celpontot a terheles elosztasa erdekeben (az Analistak rendelkeznek `last_checked` igeny-koordinacioval is, tehat soha nem hibas, de a tmux ertesites javitja a reagalasi idot).

## Anti-patternek

- ❌ Gate 1 kihagyasa, "mert ujnak tunt" — a `check-url` olcso, mindig futtasd le.
- ❌ Ures `--jd-text`-tel beszuras, "majd kesobb kitoltom" — nincs kesobb, az Analista kovetkezokent dolgozza fel.
- ❌ Megallni az elso statusznal, az atiranyitasok kovetese nelkul — egy 302-es atiranyitas egy generikus `/careers` oldalra elonek tunik; a `safe_fetch.py --status` koveti oket, minden ugrast ellenorizve.
- ❌ A jelentkezesi urlap ellenorzese Workable-on a kanonikus JD-oldal helyett — hamis pozitiv halott linkek.
- ❌ `fetch` MCP hasznalata `linkedin.com` / `wellfound.com` oldalon — blokkolt, 403-as bannert kapsz a JD helyett.
- ❌ A wrapper megkerulese `python3 -c "import sqlite3; INSERT ..."`-vel — megtoeri a dedup-invariansokat es a `found-by` koveteset, es most mar az adatbazis is visszautasitja: a `positions.url` UNIQUE. A `UNIQUE constraint failed: positions.url` azt jelenti, hogy a hirdetes mar bent van — vissza az 1. kapuhoz, ne probald ujra modositott URL-lel.
- ❌ `--status` beallitasa az alapertelmezett `new`-tol elterore (a Scout soha nem allit be statuszt manuálisan; a wrapper kezeli).

## Lasd meg

- `circles-and-sources` — mit HOL keresni (ez a skill azt irja le, mit kell tenni, MIUTAN talalsz egy jelolt poziciot).
- `scout-coord` — inditaskori particionálas (ez a skill pozicionkenti, a particionálás downstream-je).
- `db-insert` — a wrapper belso mukodese + `position` sema.
- `agents/_manual/anti-collision.md` — tágabb Scout koordinacios szerzodes.
- `agents/scout/scout.md` — az orkesztralo prompt, amely ezt a skillt hivja a fo ciklusban.
