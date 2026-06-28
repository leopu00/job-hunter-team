<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: format-time
description: UTC időbélyegek konvertálása a felhasználó időzónájába, mielőtt csevegésben, diagramokon, Telegramon vagy bármilyen felhasználó felé mutató kimenetben megjelenítenéd. Használd ezt a helper-t, amikor egyébként nyers `strftime("%H:%M")`-t írnál egy UTC datetime-ból valami felhasználó által olvasható dologba.
allowed-tools: Bash(python3 *)
---

# format-time — UTC → felhasználói időzóna felhasználó felé mutató kimenetben

Bug #15: a konténer UTC-ben fut, a felhasználó CEST/CET-ben él. Konverzió
nélkül minden "reset at 03:11" a csevegésben vagy diagramokon arra kényszeríti a felhasználót, hogy
fejben számoljon `+2`-t — és néha a felhasználó azt mondja *"itt 3:21 van"*
és a Capitano-nak kapkodnia kell a konverzióhoz.

## Mikor használd

Alkalmazd, amikor olyan időbélyeget generálsz, amelyet a **felhasználó** fog olvasni:

- Telegram üzenetek bármelyik ágenstől (Capitano, Assistente, Mentor)
- Matplotlib diagram feliratok, x-tick címkék, jelmagyarázatok
- Dashboard widgetek, amelyek időt mutatnak
- Napló sorok vagy összefoglalók, amelyeket a felhasználónak adsz vissza

**Hagyd ki**, amikor:
- Belső naplófájlokat írsz (`messages.jsonl`, `sentinel-data.jsonl`,
  `dottore-actions.jsonl`) — azok UTC ISO-ban maradnak az ágensek közötti parse-oláshoz.
- DB oszlopokat írsz — tartsd meg az UTC ISO-t, hogy a dashboard rendereléskor formázhasson.
- Intervallumokat / deltákat számolsz — UTC-ben dolgozz, csak a széleken formázz.

## Hogyan használd

```python
from shared.skills.format_time import fmt_user, fmt_user_with_utc
from datetime import datetime, timezone

now = datetime.now(timezone.utc)
print(fmt_user(now))            # "03:21 CEST"
print(fmt_user_with_utc(now))   # "03:21 CEST (01:21 UTC)"
```

Vagy bash-ból:

```bash
python3 /app/shared/skills/format_time.py --now
python3 /app/shared/skills/format_time.py --iso 2026-05-17T01:14:00Z --with-utc
```

## Mikor mutasd mindkét felhasználói időt és UTC-t

**Operatív diagramokon**, amelyeket egy ügyeletes mérnök (vagy te, hibakeresés közben)
olvashat a csapat UTC naplói mellett, válaszd az `fmt_user_with_utc`-t,
így mindkettő látható:

> *"Most 03:21 CEST (01:21 UTC) — usage 63% — proj 92.2%"*

**Sima Telegram csevegésben** a felhasználónak általában az `fmt_user` önmagában
elég:

> *"📅 Reset finestra 5h alle 05:11 CEST (~1h 50m)."*

## Honnan jön a felhasználói időzóna

`candidate_profile.yml::timezone` (IANA név, pl. `Europe/Rome`).
Alapértelmezés `Europe/Rome`, ha hiányzik — a béta felhasználók ~95%-át lefedi. Munkamenetenként
felülírható: `JHT_USER_TZ` env var (a helper olvassa).

## Anti-minták

- ❌ `datetime.now().strftime("%H:%M")` felhasználó felé mutató stringben —
  a **konténer** időt (UTC) produkálja utótag nélkül → felhasználói
  zavar.
- ❌ Kézzel írt `+2` matek bárhol. Használd a helper-t; a DST átváltja
  az Europe/Rome-t CET (+1)-re október végén és el fogod felejteni.
- ❌ `"CEST"` keményen kódolva utótagként — fél évig rossz és
  nem-olasz felhasználóknak is rossz.

## Lásd még

- `shared/skills/format_time.py` — implementáció.
- `candidate_profile.yml.example` — `timezone:` mező dokumentáció.
