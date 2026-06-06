<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: spawn-doctor
description: Indit egy friss DOTTORE-t igeny szerint, amikor neked (Capitano/Assistente/Sentinella/Mentor) azonnali health-check korre van szukseged. Ezt a skillt hasznald AHELYETT, hogy a DOTTORE sessionbe irnal, amikor a felhasznalo azt keri "fai partire il dottore" / "dottora" / "controlla il team", mert az utemezett korok kozott a DOTTORE session rezidualis bash (one-shot eletciklus, ~10 perc aktiv + ~110 perc alvas a kovetkezo 2h-ciklus spawnig).
allowed-tools: Bash(/app/.launcher/spawn-doctor.sh *), Bash(tmux *), Bash(jht-tmux-send *)
---

# spawn-doctor — surgos hivas a Dottore-hoz

## Miert letezik

A **doctor-watchdog** automatikusan indit egy DOTTORE-t 2 orankent
(utem a 2026-05-18-an valasztva a token-pazarlas csokkentesere:
napi 12 spawn 48 helyett). Ket spawn kozott a tmux session
`DOTTORE` letezik, de "rezidualis bash" (az elozo Dottore onmegsemmisitette
magat a kor vegen). `[URG]`-ot vagy `[HEALTH]`-et kuldeni ebbe a
sessionbe **hasztalan**: az uzenet a bash-ban landol es senki sem olvassa.

Klasszikus eset (post-mortem `2026-05-18-capitano-zombie-night`):
az Assistente 2 URG-ot kuldott a Dottore-nak 06:08/06:09-kor, mert
a felhasznalo kerte, de az elozo Dottore 05:48-kor onmegsemmisitette
magat → 2 URG elveszett az urben, a Capitano meg ~20 percig maradt
zombie, mig az Assistente ra nem jott, hogy kozvetlenul kell cselekednie.

Ez a skill zarja a ciklust: ahelyett, hogy "egy halott Dottore-nak
beszelnek", **azonnal inditok egy ujat**.

## Ki hasznalhatja

A 4 hosszu eletu koordinator-agens:
- 👨‍✈️ **Capitano** — amikor zombie workereket eszlel es masodik
  velemenyt akar, mielott maga vegezne respawnt.
- 💬 **Assistente** — amikor a felhasznalo "fai partire il dottore"-t
  vagy "controlla il team"-et ker Telegramon/chaten.
- 🧙‍♂️ **Mentor** — amikor heti digestben anomalis mintazatokat eszlel
  es infrastruktura-egeszseg-ellenorzest akar.
- 💂 **Sentinella** — amikor egy agens varatlanul abbahagyja a
  token-fogyasztast produktiv idoablakban.

A tobbi agens (Scout, Analista, Scorer, Scrittore, Critico) **NEM**
rendelkezik ezzel a skillel: ha problemat latnak, jelzik a Capitano-nak
`[REPORT]`-on keresztul, es rahagy jak a dontest.

## Hogyan kell hasznalni

```bash
# Spawn one-shot. A script idempotens: megol minden letezo DOTTORE*-t
# mielott ujat hozna letre, tehat felelem nelkul hivhatod,
# duplikaciok veszelye nelkul.
bash /app/.launcher/spawn-doctor.sh
```

Vart kimenet:
```
[spawn-doctor] killing old session: DOTTORE     (se presente)
[spawn-doctor] DOTTORE avviato — workdir=/jht_home/agents/dottore — round=YYYYMMDDTHHMMSSZ-spawn
```

Az uj DOTTORE LLM (Codex/Kimi/Claude az `active_provider` alapjan)
~6-10 masodperc alatt indul, beolvassa az `AGENTS.md`-t (= a Dottore
promptja), es megkezdi a health-check kort. Onmegsemmisites a vegen.

## Spawn utan — a Dottore-n keresztul lepj interakcioba (ne egyedul)

```bash
# 1. Spawn
bash /app/.launcher/spawn-doctor.sh

# 2. Varj 8-12s-ot, amig az LLM keszen all a fogadasra
sleep 10

# 3. Kuldj celzott [REQ]-et (a Dottore a standard eljarast koveti,
#    de iranyithatod, ha konkret gyanupontod van).
jht-tmux-send DOTTORE \
  "[@$MY_ID -> @dottore] [REQ] Round mirato: il Capitano non risponde da
   ~30 min, capture-pane mostra solo bash. Verifica e respawn se zombie.
   Riporta a me con [RES] alla fine."

# 4. Vard meg a Dottore [RES]-et (~10 perc standard budget) — ne pollozz
#    agressziven. A Dottore maga fogja naplozni az esemenyeket a
#    /jht_home/logs/dottore-actions.jsonl fajlba, amikor cselekszik.
```

## Mikor NE hasznald

- ❌ Zombie worker es te vagy a **Capitano**: vegezd el a respawnt
  kozvetlenul a `spawn-agent` skill + kick-off resume-mal. Nem kell
  zavarni a Dottore-t. A Dottore olyan problemakra valo, amelyek magas
  szintu LLM-et igenyelnek (token spike diagnosztika, finom deadlock,
  cross-system cache-prune).
- ❌ Kereshurok: ha mar futtattad a `spawn-doctor`-t az utolso
  15 percben, varj. Uj Dottore inditasa, mig az elozo meg dolgozik,
  megoli azt (a script idempotens `kill-session`-nel elore) — idot es
  koltsegvetest pazarolnal.
- ❌ Konkret ok nelkul: a Dottore koronkent ~3-5% Kimi-koltsegvetesbe
  kerul. Ne inditsd "ellenorizni, hogy minden rendben van-e" — erre
  mar ott van a doctor-watchdog 2 orankent. Akkor inditsd, amikor
  konkret esemenyt kell vizsgalnod.

## Anti-patterns

- ❌ `jht-tmux-send DOTTORE "[URG] ..."` elottes spawn nelkul — exit 0,
  de az uzenet elveszett a rezidualis bash-ban. Tortenelmi hiba,
  megfigyelt 2026-05-18 06:08-06:09 UTC.
- ❌ Kezzel spawnolni `tmux new-session -d -s DOTTORE`-val — megkerueli
  a prompt sync `AGENTS.md` + JSONL log + cleanup-ot. MINDIG a
  `spawn-doctor.sh`-t hasznald.
- ❌ Elvarni, hogy a Dottore nem-health taskot oldjon meg (pl. "scrivi
  un CV"). A Dottore single-purpose: liveness + cache-prune +
  py-tools-audit + cv-disk-audit. Semmi mas.

## Lasd meg

- `agents/dottore/dottore.md` — a Dottore promptja, one-shot eletciklus
- `agents/_skills/liveness-check/SKILL.md` — diagnosztika, amit a Dottore vegrehajt
- `.launcher/spawn-doctor.sh` — idempotens script (rev. legacy 2026-05-08)
- `.launcher/doctor-watchdog.sh` — 2h utemu ciklus (post-mortem 2026-05-18)
- `docs/sessions/2026-05-18-capitano-zombie-night/README.md` — az az eset, ami ezt a skillt letrehozta
