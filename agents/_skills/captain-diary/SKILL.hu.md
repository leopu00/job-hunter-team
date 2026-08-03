<!-- @translation: hu, ai-translated 2026-08-03 -->
---
name: captain-diary
description: "Napi átadási napló a Capitanónak. A Capitanót gyakran újraindítják (context-refresh, új munkaablak, reboot), és ilyenkor elvesznek a nap keservesen megszerzett pacing-tanulságai — így ugyanazokat a hibákat ismétli (pl. 3 Scout egyszerre → fékezhetetlen kiugrás → 5 óra lassított menet az adósság törlesztésére). Induláskor olvasd el az ELŐZŐ nap jegyzeteit (handoff), és FŰZZ HOZZÁ egysoros jegyzetet, valahányszor a nap folyamán valami lényeges történik (skálázási döntés, kiugrás, kill, tanulság). Naponta egy, csak hozzáfűzhető fájl."
allowed-tools: Bash(python3 /app/shared/skills/captain_diary.py *)
---

# captain-diary — az átadás Capitanók között

Naponta egy fájl a `$JHT_HOME/logs/captain-diary-YYYY-MM-DD.md` útvonalon, csak
hozzáfűzhető. A feladata, hogy ne kelljen **minden újraindításkor elölről
kezdened**: a mai pacing-tanulságok átkerülnek a holnapi Capitanóhoz.

## Ébredéskor (MINDIG, munka előtt)

Olvasd el az előző nap Capitanója által hagyott jegyzeteket:

```bash
python3 /app/shared/skills/captain_diary.py handoff
```

Kiírja a **tegnapi** jegyzeteket (vagy az utolsó ledolgozott napét), plusz azt,
ami **ma** már rögzítve van. Örökölöd a tanulságokat → **ne ismételd meg
ugyanazokat a hibákat**. Ha nincs semmi, te vagy az első: kezdd el a rögzítést.

## A nap folyamán — rögzítsd a LÉNYEGES eseményeket

Egy sor, valahányszor történik valami, ami tanulságot hordoz. NEM mindenről
vezetett napló: csak az, amire a holnapi Capitanónak szüksége lenne.

```bash
python3 /app/shared/skills/captain_diary.py add "20:05 — 3 Scout egyszerre: fékezhetetlen \
kiugrás 15 percen belül, 5 óra lassított menet az adósság törlesztésére. Tanulság: max. 1 Scout, \
utána 30 perc megfigyelés (C-02)."
```

Amit érdemes rögzíteni:
- rosszul (vagy jól) elsült skálázási döntések — hány worker, milyen throttle, mi történt;
- egy kiugrás, amit nem tudtál lefékezni, és hogyan álltál talpra utána;
- egy kill és annak oka;
- egy felismert minta (pl. "az X oldalon dolgozó Scout kétszer annyit fogyaszt");
- bármi, ami holnap — ha tudnád — megspórolna egy hibát.

## Csak a mai nap átnézése

```bash
python3 /app/shared/skills/captain_diary.py today
```

## Szabály

- A napló a **stafétabot**: olvasd el bootkor, tápláld a nap folyamán.
- A jegyzetek legyenek **rövidek és cselekvésre válthatók** (egy tény + a tanulság), ne bőbeszédű log.
- Az időbélyeget az eszköz teszi hozzá: te csak a tényt és a tanulságot írod.
