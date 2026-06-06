<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: bridge-mailbox
description: A függőben lévő bridge ítéletek kiürítése MINDEN Capitano kör ELEJÉN — KÖTELEZŐ első művelet bármi más előtt. Egy hosszú kör során a `jht-tmux-send` a bridge-ből meghiúsulhat rc=3-mal (a szöveg soha nem jelent meg a panelen), és egy `[BRIDGE PACING]` vagy `PIPELINE STALLED` ítélet csendben elvész. A bridge MINDEN ítéletet hozzáfűz egy JSONL postaládához, hogy visszanyerhesd őket. Ennek kihagyása elavult mérésekre való reagálást jelent, miközben egy frissebb ítélet olvasatlanul vár.
allowed-tools: Bash(python3 /app/shared/skills/bridge_mailbox.py *)
---

# bridge-mailbox — elveszett ítéletek visszanyerése

A bridge tmux-on keresztül kommunikál veled, de a tmux kézbesítés csendben meghiúsulhat egy hosszú kör során (Codex / Kimi TUI renderelési problémák, éppen egy hosszú tool call-ban voltál, stb.). Hogy egyetlen ítélet se vesszen el, a bridge **szintén** hozzáfűz minden tick-et egy JSONL postaládához: `$JHT_HOME/logs/bridge-mailbox.jsonl`. Minden kör elején kiüríted.

## A kötelező első művelet

*Bármi más* előtt — üzenetek olvasása, cselekvések eldöntése, másik skill megnyitása előtt — futtasd:

```bash
python3 /app/shared/skills/bridge_mailbox.py drain
```

Lehetséges kimenetek:
- `no pending verdicts` → a postaláda üres, folytasd a kört normálisan.
- egy vagy több sor, élő tmux tick-ként formázva (`[BRIDGE PACING] ...`, `PIPELINE STALLED ...`, `[BRIDGE ALERT] ...`).

A `drain` elfogyasztja a bejegyzéseket (sikeres feldolgozás esetén olvasottnak jelöli) — újrafuttatás `no pending verdicts`-et ad vissza, amíg a bridge újakat nem fűz hozzá.

## Hogyan alkalmazd a kiürített ítéleteket

Dolgozd fel AZ ÖSSZES sort, de **csak az utolsóra reagálj**. A korábbiak már elavultak — a metrikák azóta változtak. Két kivétel, ahol egy korábbi sor még számít:

1. **`PIPELINE STALLED` friss (< 30 perc) és még releváns** (a proj még alacsony, a team_kt még alacsony jelenleg). Reagálj a forgatókönyvre (indítsd újra a pipeline-t upstream), még ha egy későbbi érvényes `[BRIDGE PACING]` érkezett is utána. A leállások állapotok, nem események — tisztázni kell, nem csak mérni.
2. **Egy `[PAUSA TEAM]` / `[HARD FREEZE]`, amit kihagytál**. Ha van egy a sorban és még nem küldtél `[RIPRENDI]`-t, a csapat még befagyasztva van — kezeld a `sentinel-orders`-szel *a* legutóbbi pacing előtt.

A szokásos esetben (egy vagy több `[BRIDGE PACING]` sor):
- olvasd el minden sort az időbeli kontextus megőrzéséhez (láthatod, hogyan alakult a trend, amíg elfoglalt voltál)
- nyisd meg a `bridge-pacing` skill-t egyszer és alkalmazd csak az **utolsó** ítélet kalibrálását

## Egyéb parancsok (hibakeresés / vizsgálat)

```bash
python3 /app/shared/skills/bridge_mailbox.py status   # hány függőben lévő vs összesen
python3 /app/shared/skills/bridge_mailbox.py peek     # olvasás fogyasztás nélkül
```

Használd a `peek`-et, amikor gyanúsnak találsz valamit és meg akarod nézni kötelezettségvállalás nélkül — NEM jelöli a bejegyzéseket olvasottnak.

## Anti-minták

- ❌ A kiürítés kihagyása "mert a kör rövidnek tűnik" — az rc=3 hibák kiszámíthatatlanul történnek; egy kihagyott tick egy hosszú kör során a tipikus eset.
- ❌ Reagálás minden kiürített sorra sorban — újrajátszanád az elavult throttle változtatásokat, harcolnál a saját múltbeli kalibrálásaiddal, és oszcillálnád a csapatot.
- ❌ A `drain` futtatása kör közben csak hogy "megnézd mi jött" — a drain fogyaszt; ha nem vagy kész reagálni a sorokra, használj `peek`-et helyette.
- ❌ A `peek` kimenetet tekintélyesnek kezelni — a `peek` a függőben lévő bejegyzéseket mutatja, de az élő tmux panel már tartalmazhat újabbakat, amelyeket a JSONL még nem rögzített. A kör eleji drain adja a konzisztens képet.

## Lásd még

- `sentinel-orders` — a `[PAUSA TEAM]` / `[HARD FREEZE]` / `[RIPRENDI]` irányítása kiürítés után.
- `bridge-pacing` — az utolsó `[BRIDGE PACING]` sorra alkalmazandó képlet.
- `pipeline-triage` — forgatókönyv a `PIPELINE STALLED` kezelésére (pipeline újraindítása upstream).
