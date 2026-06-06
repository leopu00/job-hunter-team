<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: py-tools-audit
description: "Koordinalt, csapatszintu takaritas a `$JHT_HOME/.local` ala telepitett Python csomagokbol, amelyek `uv pip install --user` segitsegevel kerultek oda (T13 magazzino). A Dottore felelos erte. Az audit NEM egyoldalu -- csak a Writer / Critic agensek tudjak, hogy egy dinamikusan importalt konyvtar meg hasznos-e nekik, ezert a folyamat: broadcast -> 1 oras beleegyezesi ablak -> a csendes halmazt eltavolitjuk -> ujra-audit. Mivel a Dottore one-shot (~10 perc koronkent, ~30 perc kozott), az 1 oras beleegyezesi ablak 2 Dottore-kort fed le: az N. kor inditja az auditot + broadcastot, az N+1. kor osszegyujti a valaszokat + eltavolit."
allowed-tools: Bash(python3 /app/shared/skills/py_tools_audit.py *), Bash(uv pip uninstall *), Bash(jht-tmux-send *), Bash(tmux *), Bash(du *), Bash(xargs *)
---

# py-tools-audit — a kozos Python magazzino takaritasa

A `$JHT_HOME/.local/lib/python3.x/site-packages/` az **egyetlen kozos user-base**, amelybol minden agens olvas (T13). Barmely agens futtathat `uv pip install --user <pkg>` parancsot, amikor konyvtarra van szuksege, de az agensek *nem* tavolitjak el a csomagokat, amikor megkozelitest valtanak — a csomagok felhalmozodnak. Nagyjabul hetente a magazzino atlepi a 800 MB-ot, es koordinalt auditra van szukseg.

Az audit azert koordinalt, mert egy statikus `import` grep lemaradhat a futasidoben dinamikusan betoltott konyvtarakrol (pl. egy `tools/` beli szkript, amelyet a Writer csak akkor hiv meg, amikor egy JD specialis formatumot ker). Ezert: kerdezzunk az eltavolitas elott.

## Trigger

- ⏰ ~hetente (minden 7 folyamatos futasi nap utan), egy csendes uzemeltetesi nap elejen
- 📈 igeny szerint, amikor `du -sh /jht_home/.local` > 800 MB
- 🚀 fontos release / felhasznaloi atadas elott

## Ketkoroses folyamat (mert a Dottore one-shot)

```
Round N:    audit → jeloltek broadcastolasa → allapotfajl mentese
…30 perc…
Round N+1:  valaszok osszegyujtese → keep_set szamitasa → eltavolitas → ujra-audit → jelentes
```

Minden kor rogziti a fazisit a `$JHT_HOME/logs/py-audit-state.json` fajlban:

```json
{"phase": "broadcast_sent", "round_id": "...", "ts": "ISO-UTC",
 "candidates": ["pymupdf", "pdfminer.six", "reportlab", "..."],
 "broadcast_at": "ISO-UTC"}
```

Amikor feleberedsz, **eloszor ezt a fajlt ellenorizd**:
- fajl hianzik vagy `phase=done` → uj kor, menj a lenti "Round N"-hez
- `phase=broadcast_sent` es `now - broadcast_at >= 1h` → lenti "Round N+1"
- `phase=broadcast_sent` es `now - broadcast_at < 1h` → a beleegyezesi ablak meg nem zart le, hagyd ki az auditot ebben a korben

## Round N — az audit inditasa

### 1. Kuszobertek-ellenorzes

```bash
python3 /app/shared/skills/py_tools_audit.py --threshold-mb 800
```

- Exit `0` → semmi surgos. Allj meg itt, ne kuldj broadcastot.
- Exit `2` → erdemes takaritani. A szkript kinyomtatja a *jelolt-tablazatot* is — aktiv import nelkuli csomagok, a whitelist kivetelevel (tranzitiv fuggosegek + rogzitett binaris CLI-k).

### 2. Broadcast minden agensnek

Kuldj egy `[PY-AUDIT]` uzenetet minden elo agens-munkamenetnek a `jht-tmux-send` segitsegevel:

```
[@dottore -> @<role>] [PY-AUDIT] candidates uninstall: pymupdf,
pdfminer_six, reportlab, weasyprint, pypdf, ...
If you USE one of these, reply within 1h with [KEEP <pkg>].
Silence = consent to uninstall.
```

Az 1 oras ablakot a **kovetkezo kor indulasa** ervenyesiti, nem egy `sleep` ebben a korben (a Dottore one-shot). Tarold a broadcast idejet a `py-audit-state.json` fajlban.

### 3. Allapot mentese es kileptes a korbol

```json
{"phase": "broadcast_sent", "round_id": "...",
 "candidates": ["..."], "broadcast_at": "ISO-UTC"}
```

Round N vege. Szokasosan onmegsemmisites; a kovetkezo Dottore (~30 perccel kesobb) innen folytatja.

## Round N+1 — gyujtes, eltavolitas, jelentes

Akkor aktivizalodik, amikor a `py-audit-state.json` `phase=broadcast_sent`-et mutat es ≥1h eltelt.

### 1. Valaszok osszegyujtese

Minden broadcastolt agensnel futtasd: `tmux capture-pane -t <SESSION> -p -S -200 | grep '\[KEEP '` a `[KEEP <pkg>]` valaszok megtalalasahoz. Epitsd fel a `keep_set`-et:

```
keep_set = (alapertelmezett whitelist) ∪ (minden <pkg> barmely [KEEP] valaszbol)
```

Csend egy jeloltrol = beleegyezes az eltavolitasba.

### 2. A csendes halmaz eltavolitasa

```bash
python3 /app/shared/skills/py_tools_audit.py --candidates-only --keep <keep_set...> \
  | xargs -r uv pip uninstall --user -y
```

Az `xargs -r` kihagyja a hivast, ha nincs mit eltavolitani (ures stdin).

### 3. Ujra-audit + jelentes

```bash
python3 /app/shared/skills/py_tools_audit.py
du -sh /jht_home/.local
```

Szamitsd ki: `freed_mb = before - after`, es ertesitsd a felhasznalot a Capitano-n keresztul:

```bash
jht-tmux-send CAPITANO "[@dottore -> @capitano] [REPORT] py-audit done: <N> packages removed, <freed_mb> MB freed. Magazzino now <after_mb> MB."
```

### 4. Allapot visszaallitasa

```json
{"phase": "done", "round_id": "...", "completed_at": "ISO-UTC",
 "removed": ["..."], "freed_mb": 142}
```

Egy tiszta `py-audit-state.json` `phase=done` ertekkel lehetove teszi a kovetkezo kor ujrainditasat nullarol.

## Szigoru szabalyok

- **Soha ne tavolitsd el broadcast + 1 oras ablak nelkul.** Egyes csomagok dinamikusan toltodnek be, es nem jelennek meg statikus grepben — a broadcast az egyetlen mod az elkapasukkra.
- **Soha ne nyulj az `ALWAYS_KEEP`-hez.** A tranzitiv bejegyzesek (numpy, pillow, packaging stb.) jo okkal vannak ott; az audit szkript mar ki is zarja oket.
- **Ha egy Writer tiltakozik egy eltavolitas utan**, azonnal telepitsd ujra es add hozza a csomagot az `ALWAYS_KEEP`-hez. Kezeld ezt folyamati bugkent (a broadcast nem erte el az agenst), nem a Writer hibajakent.
- **Soha ne hasznalj sudo-uninstall-t.** Maradj a `uv pip uninstall --user` keretein belul. T13 ugyanazert tiltja a `sudo pip`-et, amiert a `sudo pip install`-t is.

## Anti-patternek

- ❌ Mindket kort egyetlen Dottore-ebredes alatt futtatni `sleep 3600`-zal — meghaladja a koronkenti 10 perces keretet es megtori a watchdog utemet.
- ❌ A keep set levezetese sajat `import` grepbol broadcast nelkul — csendes hibak dinamikus betolteseknel.
- ❌ Tobb mint 100 csomag eltavolitasa egyetlen korben — tul zajos, nehez visszaallitani. Korlatozd az audit termeszetes kotegeire (amit a kuszobertek-szkript visszaad).
- ❌ Ennek a skillnek a futtatasa egy Sentinel `[ORDINE]`-re valo reakciokent — a parancsok pacing/scaling-et igenyelnek, nem karbantartast. A py-audit egy tevetlen ablakra var.

## Lasd meg

- `cache-prune` — testver karbantartasi skill (uv wheel cache, ~24h utem). Futtasd eloszor; neha a magazzino meretet 800 MB ala csokkenti, es feleslegesse teszi az auditot.
- `agents/_team/team-rules.md` T13 — telepitesi szabaly (`uv pip install --user`), ami indokolja ezt az auditot.
- `agents/dottore/dottore.md` — a Dottore eletciklusa; ez a skill 2 eletciklus-kort fed le az allapotfajlon keresztul.
