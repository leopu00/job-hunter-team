<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: cache-prune
description: "Lemezterület visszanyerése a megosztott JHT gyorsítótárakból (`uv` wheel cache + `codex` SQLite napló) ~24 óránként. A Dottore felelőssége — egyetlen példány, a rutin kör végén fut, amikor a csapat inaktív. Soha ne futtasd vészhelyzet közben: az SQLite VACUUM ~30 másodpercre blokkolja egy 200 MB-os DB-n, és elvenne ciklusokat egy Sentinel-vezérelt helyreállítástól. A Capitano-tól migrálva, hogy a Capitano a koordinálásra összpontosíthasson, ne karbantartásra."
allowed-tools: Bash(node /app/cli/bin/jht.js cache *), Bash(du *), Bash(df *)
---

# cache-prune — megosztott gyorsítótárak visszanyerése

A megosztott `$JHT_HOME` két gyorsítótárat halmoz fel, amelyek monoton nőnek, amíg vissza nem nyerik:

| Útvonal                               | Mit tárol                               | Tipikus növekedés (2026-05-02 minta) |
|---------------------------------------|-----------------------------------------|------------------------------------|
| `$JHT_HOME/.cache/uv/`                | wheel cache minden `uv pip install`-hoz | ~364 MB                            |
| `$JHT_HOME/.codex/logs_2.sqlite`      | Codex telemetria SQLite (71% TRACE sor) | ~223 MB                            |

Egyik sem szükséges a lemezen: uv újra letölti, ha kell, Codex biztonságosan csonkítja a TRACE sorokat. A fenti számok folyamatos futásból származnak; friss `$JHT_HOME`-on 0-ról indulnak és néhány napon belül elérik a több száz MB-ot.

## Az egyetlen biztonságos parancs

```bash
node /app/cli/bin/jht.js cache prune
```

Idempotens és no-op, amikor nincs mit visszanyerni. Belsőleg:
1. `uv cache prune` — eldobja az elavult wheel-eket (megtartja az aktuális telepítések által hivatkozott aktív készletet).
2. SQLite `VACUUM` a `logs_2.sqlite`-on a régi TRACE sorok törlése után.
3. Ideiglenes Codex temp fájlok tisztítása.

Minden lépésnek van egy biztonsági kapuja: `idle > 1h` a destruktív műveleteknél (VACUUM zárolás, TRACE törlés) — ha a csapat aktívan fogyaszt tokeneket, a lépés kimarad.

## Mikor futtasd

- 👨‍⚕️ **Rutin Dottore kör végén** (~24 óra folyamatos futás, vagy egy inaktív munkanap elején).
- 📉 **Igény szerint**, ha `du -sh $JHT_HOME/.cache $JHT_HOME/.codex` összesen > 800 MB növekedést mutat.
- 🚫 **SOHA** költségvetés-kritikus időben (proj > 95%) — a VACUUM 30 másodperces zárolása blokkolja a Codex SQLite-ot, amelyet a Sentinella a bridge-en keresztül olvas.
- 🚫 **SOHA** Sentinel `[ORDINE]`-ra reagálva — a parancsok pacing/skálázási műveleteket igényelnek, nem karbantartást.

## Biztonság: mit NE érintsünk

A csapatnak *más* gyorsítótárai is vannak, amelyek hasonlónak tűnnek, de NEM tartoznak ide:

| Útvonal                              | Miért tiltott                                                     |
|--------------------------------------|-------------------------------------------------------------------|
| `.cache/ms-playwright/`              | verzió által rögzített böngésző binárisok — újraletöltésük lassú + bizonytalan |
| `.cache/claude-cli-nodejs/`          | Anthropic CLI futásidejű cache, lustán újragenerálódik, de meleg állapotban nagyobb |
| `$JHT_HOME/logs/`                    | A Sentinella állapota itt él. Törlése elveszíti az EMA ablakot és a monitorozási előzmények több percét. |

A `cache prune` hatósugara a fenti táblázat két útvonalára korlátozódik.

> ⚠️ **A `cache clear` TILTOTT.** Ez a parancs (a `cache prune` destruktív rokona, amelyet a `jht` tesz elérhetővé) a `logs/`-t is törli a gyorsítótárakkal együtt, megsemmisítve a Sentinella állapotát. Ha bármikor kedved támad `cache clear`-t futtatni, eszkaláld a felhasználónak inkább.

## Rendellenes növekedés — eszkaláció

Ha a `du -sh` azt mutatja, hogy a 2 célterületen *kívüli* útvonal gyorsan nő (pl. `.cache/ms-playwright/` megduplázódott, `.codex/sessions/` felduzzad), **NE** prunáld saját hatáskörben. Rögzítsd:

```bash
du -sh $JHT_HOME/.cache/* $JHT_HOME/.codex/*
df -h $JHT_HOME
```

…naplózd a `dottore-actions.jsonl`-be `event=disk_anomaly` + a `du` kimenettel, és felszínezd a felhasználónak a Capitano-n keresztül (`jht-tmux-send CAPITANO`). Egy új, növekvő útvonal azt jelentheti, hogy egy új eszközt adtak hozzá a tisztítási költségvetés nélkül.

## Kimenet a naplóba

Fűzd hozzá a `/jht_home/logs/dottore-actions.jsonl`-hez:

```json
{"ts": "ISO-UTC", "round_id": "...", "event": "cache_prune",
 "uv_freed_mb": 142, "codex_freed_mb": 87, "total_freed_mb": 229,
 "duration_sec": 31}
```

Ha egy lépést az idle kapu kihagyott, állítsd a megfelelő `_freed_mb`-t `null`-ra és adj hozzá `"skipped": ["vacuum"]`.

## Anti-minták

- ❌ A `cache prune` futtatása a Capitano-ból — ez a felelősség ide lett migrálva. A Capitano koordinál, a Dottore karbantart.
- ❌ Futtatás, miközben egy Író CV-t ír (a ciklusa alkalmanként érinti az uv cache-t pandoc/typst könyvtárakhoz).
- ❌ Cron-szerű ciklus hozzáadása a Dottore promptjában — a Dottore egyszer lő ~30 perces ütemben, a cache-prune-t a kör végén illeszted be, amikor van értelme, nem rögzített ütemterv szerint.
- ❌ A `jht.js cache prune` wrapper megkerülése közvetlen `uv cache prune` / `sqlite vacuum` futtatásával — kihagyod az idle kaput és az egységes naplózást.

## Lásd még

- `agents/dottore/dottore.md` — mikor illeszd be a Dottore életciklusába ezt a skill-t (csak kör végén).
- `py-tools-audit` — testvér karbantartási skill (Python csomagok, ~heti ütem).
- `agents/_team/team-rules.md` T13 — az uv-mint-egyetlen-telepítő szabály (miért létezik az uv cache).
