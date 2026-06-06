<!-- @translation: hu, ai-translated 2026-06-06 -->
# 🛡️ Anti-tkzsi Protokoll

Amikor tbb azonos szerep gens ugyanabbl a sorbl dolgozik, el KELL kerlnik, hogy ugyanazon a rekordon dolgozzanak. A mechanizmus **szerepspecifikus** — minden fzis az adott munkaminthoz legjobban ill zrolsi stratgit hasznlja.

## 🎯 Szerepenknt zrolsi mechanizmusok

### 🕵️ Scout — deduplikci INSERT eltt

A Scoutok *j* rekordokat rnak, gy nem tudnak olyasmit zrolni, ami mg nem ltezik. Az tkzsi kockzat az, hogy kt scout ugyanazt az llshirdetst illeszti be klnbz forrsokbl. Mechanizmus:

```bash
# INSERT eltt ellenrizd, hogy az URL mr benne van-e az adatbzisban
python3 shared/skills/db_query.py check-url "<url>"
# "TROVATA"-t ad vissza (kihagys) vagy "NON TROVATA"-t (INSERT folytatsa).
```

Indulskori partcionls: a scoutok **krket** s **forrsokat** is egyeztetnek a `scout_coord.py` segtsgvel, hogy eleve ne feddk t ugyanazon a forrson. Rszletekrt lsd: `agents/scout/scout.md`.

### 👨‍🔬 Elemz  👨‍💻 Scorer — `last_checked` vzjel

Mindketten egy sorbl dolgoznak (`status = new` az Elemzknek, `status = checked` a Scorereknek) s meglv rekordokat frisstik. Az tkzsi kockzat az, hogy kt trs egyszerre vlasztja ki ugyanazt a rekordot. Mechanizmus:

1. **Olvasd** a `last_checked` rtkt a jellt rekordnl.
2. **Ha friss** (egy trs az elmllt percekben blyegezte) → kihagys; vedd a kvetkezt.
3. **Egybknt** blyegezd: `last_checked = now()` az ignylshez, majd dolgozz.

```bash
# Ignyls
python3 shared/skills/db_update.py position <ID> --last-checked now
```

A vzjel lgy zr: csak azt jelzi, hogy "nemrg rintettk", nem azt, hogy "vglegesen zrolva". Az elavult ignylsek kezelse az gens megtsre van bzva (lsd § Elavult ignylsek lentebb).

### 👨‍🏫 r — `status = writing` tkapcsols

Az rk a `status = scored` llapotbl dolgoznak. Az tkzsi kockzat az, hogy kt r ugyanazt a magas pontszmú pozcit ragadja meg. Mechanizmus:

```bash
# Atomi ignyls sttusz-tkapcsolssal
python3 shared/skills/db_update.py position <ID> --status writing
```

A `next-for-scrittore`-t futtat trsak nem ltjk a mr `status = writing` llapotban lv rekordokat, gy maga a tkapcsols a zr. Kiegszt jrarsi szably: ha az `applications.critic_verdict` mr be van lltva, **felttlenl kihagyand** (az tlet vgleges).

## 📡 Kommunikci

Amikor egy gens trsakat kell rtestenie (pl. "tveszem a 42-44 ID-kat") vagy az alvllt kell rtestein (pl. Scout → Elemz friss kteg), hasznld az atomi wrappert:

```bash
jht-tmux-send <PEER_SESSION> "[@me -> @peer] [INFO] taking IDs 42-44"
```

⚠️ **Ne hasznld kzvetlenl a `tmux send-keys` parancsot**: a Codex/Kimi TUI-k elvesztik az Enter karaktert, ha az ugyanabban a `send-keys` hvsban rkezik, mint a szvegtrzzs. A wrapper atomikusan kezeli a szveget + Entert egy renderelsi sznnettel. Skill: `agents/_skills/tmux-send/jht-tmux-send`.

## 👨‍⚕️ Elavult ignylsek (ritka produkciban)

A produkcibanfut gensek hnapokon t futnak meglls nlkl — az elavult ignylsek leginkbb a tesztkrnyezet termkei. Amikor mgsem elfordulnak:

- **Ne lopd el vakon az elavult ignylst.** Egy 10 perces `last_checked` lehet egy trs, aki egyszeren lass egyetlen rekordon, nem egy halott munkamenet.
- **Elszr ellenrizd a trs letjelt.** Nzd meg a trs tmux munkamenett (`tmux has-session -t <peer>`); vizsgld meg a panelt (`tmux capture-pane -p`), hogy mg dolgozik-e, egy fetch-en akad el, vagy tnylegesen halott.
- **Ha a trs l, de elakadt**, eszkalld a Kapitnyhoz ahelyett, hogy elragadnd tle a rekordot.
- **Ha a trs halott**, ignyeld a rekordot magad s rtestsd a Kapitnyt.

A szndak: kerlni a csendes rekord-lopst. A visszaignylsi dntseknek tudatosaknak kell lennik, nem automatikusaknak.

## 📋 Kzs szablyok

- **Olvass ignylses eltt.** Mindig ellenrizd a rekord aktulis llapott, mieltt ignyled.
- **Az els rs nyer.** Ha kt gens versenyzik ugyanazrt a rekordrt, az els adatbzis-frsstst nyer; a vesztes kihagyja s veszi a kvetkezt.
- **Soha ne DELETE.** Hasznld a `--status excluded` opcit megjegyzsekkel, ha egy rekord rvnytelennek bizonyul; soha ne pusztts el adatot.
- **Frisstsd a vgleges sttuszt, ha ksz vagy.** Munka utn: `checked` (Elemz), `scored` / `excluded` (Scorer), `ready` / `excluded` (r).

## 🛠️ Jvbeli egyessts (tervezett)

Egy `positions.claimed_by + claimed_at` pr szerepel az tervben a **ktegelt ignylsek** lehetsge rdekben (egyetlen atomi `UPDATE … LIMIT N` rekordonknti N krut helyett) s egy vals idej gens-aktivits nzet biztostsra a UI dashboardon. A fenti szerepspecifikus mechanizmusok ezzel prhuzamosan tovbbra is mkdni fognak. Lsd ROADMAP § *Database schema optimization*.
