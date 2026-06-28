<!-- @translation: hu, ai-translated 2026-06-20 -->
---
name: email-monitor
description: "Nap eleji sourcing a csapat DEDIKALT email fiokjabol (a felhasznalo ide tovabbitja a sajat allas-ertesiteseit). A legpontosabb forras: az ertesites mar elore szurt a felhasznalo szandekara. IMAP poll BARMELY platformrol (LinkedIn/Glassdoor/Indeed + nemzeti/varosi/nichje board-ok), pozitiokat hoz letre source taggel, idempotens Message-ID alapjan. A VOLUMENT a Capitano egyensulyozza (C-16): a nap elejen az emailt OLVASSUK a web scraping ELOTT; flood eseten csak a kiemelkedoeket vesszuk be, igy a tolcser elejut a SCORE-ig."
allowed-tools: Bash(python3 /app/shared/skills/email_monitor.py *), Bash(python3 /app/shared/skills/scout_dedup.py *), Bash(python3 /app/shared/skills/db_insert.py *), Bash(python3 /app/shared/skills/db_query.py *)
---

# email-monitor — a tovabbitott allas-ertesitesek olvasasa, a nap elejen

A felhasznalo egy **dedikalt** emailt hoz letre (pl. `nev.jht@gmail.com`) es a
sajat kliensen olyan **tovabbitasi szabalyokat** allit be, amelyek elkuldik nekunk
az allas-ertesiteseket (LinkedIn, Glassdoor, Indeed **es barmely mas platform**,
ami emailben ertesit). Te elolvasod azt a fiokot es az ertesiteseket pozitiokka
alakitod. Ez a leg**pontosabb** forras (az ertesitest mar a felhasznalo szurte a
celra) es a leg**olcsobb tokenben** (nincs vak scraping).

> 📍 **Opcionalis, de ajanlott.** Ha nincs beallitva, a csapat ugy dolgozik, mint
> korabban (web sourcing). Nincs blokk.

## Mikor

- **A munka-ablak elejen** (nap eleje): olvasd az emailt a web scraping **ELOTT**.
  Az ejszakai ertesitesek mar ott vannak.
- Aztan legfeljebb ~30 percenkent (az IMAP szerver oldalon rate-limitalja a
  surubbet, es uj ertesitesek sem erkeznek gyakrabban). Ne pollozz surubben.
- A forras claim-je a STEP 0-ban (`scout-coord`): `scout_workspace.py claim
  <agent> email:<box>` — egyetlen Scout a fiokra, nincsenek utkozesek.

## Eljaras

### 1. Be van allitva?
```bash
python3 /app/shared/skills/email_monitor.py status
```
`configured=false` → a fiok nincs meg: hagyd ki, csinald a normal web sourcingot.
`any_platform=true` azt jelenti, hogy a **teljes** dedikalt inboxot feldolgozzuk
(nincs szukitett `from_filters`) → minden feladot, akit a felhasznalo tovabbit,
elolvasunk.

### 2. Becsuld meg a VOLUMENT (olcso, nincs body fetch)
```bash
python3 /app/shared/skills/email_monitor.py count
```
Visszaadja a `new_total` + `by_sender` ertekeket. Arra szolgal, hogy **te es a
Capitano** megertsetek, kezelheto volumen-e vagy **flood**. Flood eseten **a
Capitano (C-16) megmondja, hany / melyik** kerul beolvasasra: a cel az, hogy a
pozitiok eljussanak egy **score**-ig, ne 200 soha ki nem ertekelt halmozodjon fel.

### 3. Poll → leads
```bash
python3 /app/shared/skills/email_monitor.py poll --since-days 1
```
Minden JSONL sor egy lead: `{"url","source","subject","sender","received_at"}`.
- `source` = `linkedin-email` / `glassdoor-email` / `indeed-email` az ismert
  szolgaltatoknal, `email:<domain>` barmely mas platformnal (altalanos kinyeres).
- Az idempotencia (Message-ID a `state/email_monitor_seen.json`-ban) garantalja,
  hogy egy ujrafuttatas **ne** dolgozza fel ujra ugyanazokat az ertesiteseket.

### 4. Minden lead-hez → a `position-insert` 5 gate-je
Kezeld minden `url`-t **pontosan ugy, mint egy web hit**: dedup (`scout_dedup.py`)
→ aktiv link ellenorzese → JD fetch → 4 Scout szuro → INSERT a `positions`-be
(`status=new`). **Tartsd meg a lead `--source` tagjet** (`linkedin-email`,
`email:<domain>`): ez teszi a dashboardon **merhetove a pontossagot forrasonkent**.
A JD kotelezo (SC-02): ha nem tudod lekerni, ne talald ki.

## Egyensulyozas (a Capitano dontese, C-16)

Az olvasas ingyenes (`poll`/`count`), a score-ig **feldolgozni** koltseges. A
donteshozo a Capitano, nem egy keplet:
- Esszeru volumen → dolgozd fel mind (tobb jel jobb).
- Flood → csak a **kiemelkedoeket** vidd tovabb, ket kriteriummal kizarolag a
  metaadatokbol (ingyenes): **(1) egyezes a felhasznalo profiljaval/celjaval**
  (szerepkor/kulcsszo a `subject`-ben/cimben) es **(2) frissesseg** (a `received_at`
  a legujabb). A tobbit a kovetkezo ablakokban veszed elo.
- Cel: a pozitiok **eljutnak egy score-ig**, nem halmozodnak fel kiertekeletlenul.
  Nincsenek fix kuszobok — a Capitano donti el, hany, a koltsegvetes alapjan.

## Anti-minta

- ❌ ~30 percnel surubben pollozni (IMAP rate-limit, nincs uj ertesites).
- ❌ INSERT teljes JD nelkul (SC-02) vagy a `source` tag nelkul.
- ❌ Flood eseten lavinaszeruen letrehozni a Capitano dontesenek (C-16)
  figyelmen kivul hagyasaval: felfujja a sort olyan pozitiokkal, amelyek soha nem
  jutnak el egy score-ig.
- ❌ A dedup (SC-05) megkerulese: ugyanazok az ertesitesek minden nap ismetlodnek.

## Lasd meg

- `position-insert` — az INSERT 5 gate-je (a standard folyamatod).
- `scout-coord` — az `email:*` forras claim-je boot-kor (utkozes-elhararitas).
- `circles-and-sources` — a web sourcing, amit a nap elejen az email UTAN kell csinalni.
