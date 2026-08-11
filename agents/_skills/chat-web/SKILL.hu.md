<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: chat-web
description: Válaszolj a felhasználónak, amikor a JHT webes csevegésről ír neked. A felhasználó a `[@utente -> @capitano] [CHAT] <tartalom>` előtaggal ér el; válaszolj CSAK `jht-send`-del — soha ne írj kézzel a `chat.jsonl`-be (a shell idézőjelezés megtöri a JSON sort és a frontend csendben eldobja az üzenetet, a felhasználó semmit sem lát, miközben te azt hiszed, válaszoltál). Használd ezt a skill-t minden `[CHAT]` üzenetnél; NE használd ágensek közötti forgalomhoz (arra a `tmux-send` van).
allowed-tools: Bash(jht-send *)
---

# chat-web — felhasználó ↔ Capitano protokoll

A felhasználó **nem** ül egy tmux munkamenetben. A webes felületről ír. A frontend címkézi az üzenetet és bedobja a tmux paneledbe. A válaszoláshoz egyetlen JSON sort írsz a `$JHT_AGENT_DIR/chat.jsonl`-be; a frontend figyeli ezt a fájlt és buborékokat renderel a csevegés panelen.

Nem te írod a JSON-t. A `jht-send` wrapper csinálja, időbélyeggel + `done` jelzéssel + írás utáni validálással. Használd. Mindig.

## Hogyan ismerd fel a bejövő `[CHAT]`-et

```
[@utente -> @capitano] [CHAT] <amit a felhasználó írt>
```

- A boríték azonos az ágensek közötti üzenetekkel (ugyanaz a `[@from -> @to]` forma), de a `[CHAT]` típus és az `@utente` szerző egyértelművé teszi.
- A felhasználó **ember, a profil tulajdonosa** — nem ágens. Nincs `tmux send-keys`, amivel válaszolhatnál: a munkamenetük nem létezik.
- A **tartalomra** válaszolj, ne a borítékra. A felhasználó nem gépelte be az előtagot; a frontend adta hozzá.

> ⚠️ Gyakori hibamód, amikor először látod ezt: olvasod az előtagot és arra gondolsz "válaszoljak `jht-tmux-send`-del a felhasználónak". A `jht-tmux-send UTENTE ...` `exit 2`-vel tér vissza (nincs ilyen munkamenet). Ne kezdj hibakeresni — csak emlékezz, hogy `[CHAT]` ⇒ `jht-send`. Mindig.

## ⚠️ A felhasználó NEM technikai — nincs terminál, nincs CLI, nincsenek slash-parancsok

Egy `[CHAT]` üzenet az **asztali appból** (vagy Telegramból) érkezik. A felhasználónak
**nincs** terminálja, sem Claude Code CLI-je, sem `/mcp`-je, sem slash-parancsa, sem
fájl-hozzáférése. Nem fejlesztő. **SOHA** ne mondd neki, hogy:

- futtasson `/mcp`-t, `/config`-ot vagy bármilyen slash-parancsot,
- nyisson terminált / futtasson CLI-parancsot / szerkesszen fájlt / "engedélyezzen egy eszközt",
- csináljon bármit, amit te magad is meg tudnál csinálni.

Azt mondani egy asztali felhasználónak, hogy „írd be a `/mcp`-t a terminálba", zsákutca
— nem tudja megtenni. Ha egy feladathoz olyan képesség kell, amit nem kötöttél be,
**oldd meg te magad kóddal**, ahelyett, hogy visszadobnád a munkát a felhasználóra. Te
vagy a csapat; a felhasználó az ügyfél. Találd ki.

### Példa: email küldése — NEM kell MCP/Gmail eszköz
A csapatnak már megvannak az email-hitelesítő adatai itt:
`$JHT_HOME/credentials/email_monitor.json` (egy Gmail app-jelszó — SMTP-hez is
érvényes). Írj egy kis Python szkriptet és küldd el:

```python
import os, json, smtplib, ssl
from email.message import EmailMessage
c = json.load(open(os.path.join(os.environ["JHT_HOME"], "credentials", "email_monitor.json")))
m = EmailMessage()
m["From"], m["To"], m["Subject"] = c["user"], "<cimzett>", "<targy>"
m.set_content("<torzs>")
# Gmail: smtp.gmail.com:465. Más szolgáltatóhoz vezesd le az smtp.<domain>-t vagy képezd le.
with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context()) as s:
    s.login(c["user"], c["password"]); s.send_message(m)
```

Aztán válaszolj: „Kész, elküldve ✅" — soha ne „menj és engedélyezd a Gmailt".

### Ha tényleg slash-parancs / eszköz kell a SAJÁT munkamenetedben
Te magad vezérelheted a saját munkamenetedet — ne a felhasználót kérd:

- **Öninjektáld** a saját tmux munkamenetedbe:
  `jht-tmux-send <SAJÁT_MUNKAMENET> '/mcp'` (majd egy külön Enter), vagy
- **kérj meg egy másik ügynököt**, hogy injektálja helyetted: pl. az Asszisztens
  megkéri a Kapitányt (`jht-tmux-send CAPITANO '...injektáld a /mcp-t ASSISTENTE-be...'`)
  és a Kapitány lefuttatja a `jht-tmux-send ASSISTENTE '/mcp'`-t. A felhasználó sosem érintett.

## Válasz parancsok

```bash
jht-send 'Végső válasz, ami lezárja a kört.'
jht-send --partial 'Dolgozom rajta…'   # kör közbeni ellenőrzési pont, nyitva tartja a kört
```

Szabályok:
- **Egy `[CHAT]` ⇒ legalább egy `jht-send`. Nincs kivétel.** Ha semmit nem írsz, a felhasználó egy befagyottnak tűnő csevegést bámul.
- **A kör záró üzenetének NINCS `--partial`-ja.** Ha elfelejted, a frontend a gépelési pontokat mutatja örökké (amíg egy tartalék időtúllépés ~10 perc múlva meg nem szünteti).
- **Idézőjelek**: add meg a törzset egyetlen pozicionális argumentumként. Szimpla idézőjelek megőrzik a `$`, `"`, emoji, ékezetes karaktereket szó szerint. Ha a törzs literális `'`-t tartalmaz, használj dupla idézőjelet (`jht-send "non c'è problema"`) — de `"..."`-n belül a shell kiértékeli a `$var`-t, tehát légy óvatos.
- **Többsoros**: bash `$'sor1\nsor2'`, vagy használj `\n`-t a stringen belül és hagyd, hogy a Python megőrizze.

## Mikor használd a `--partial`-t

Használd, ha egy felhasználó felé irányuló művelet ~3 másodpercnél tovább tart, és még nincs válaszod. `--partial` nélkül a felhasználói üzenet és a végső válasz között a frontend elrejti a gépelési pontokat és a csevegés halottnak tűnik.

Minta:
```
[CHAT] érkezik
   ↓
jht-send --partial 'Utánanézek — adj egy pillanatot…'
   ↓
(végezd el a munkát: db_query, capture-pane, elemzés, …)
   ↓
jht-send 'Íme, amit találtam: …'   ← nincs --partial = lezárja a kört
```

Ha egyetlen művelet ~30-45 másodpercnél tovább tart jel nélkül, küldj egy újabb `--partial` ellenőrzési pontot. A felhasználó soha nem maradhat csendben ennél tovább.

## Példák (Capitano ↔ felhasználó)

```bash
# Válasz a pipeline állapotáról — gyors, egy lövés
jht-send 'Pipeline 132 pozícióval: 18 új, 47 ellenőrzött, 31 pontozva, 28 kész. Két író aktív.'

# Hosszú futású elemzés — ellenőrzési pont, majd lezárás
jht-send --partial 'Statisztikákat és az utolsó 50 felülvizsgálatot húzom le — egy pillanat…'
# (futtatsd db_query.py stats, db_query.py applications --critic-score-max 5)
jht-send $'Íme a kép:\n\n• Pipeline egészséges a felfedezési oldalon.\n• Írók elakadtak 4 pozíción 3.2 átlagos pontszámmal → szüneteltetem őket és újranyitom a triázst.'

# A kör lezárása egy felhasználói kérés alkalmazása után
jht-send 'Kész. Elindítottam egy extra Analystot, a throttle konfig kiírva a naplóba.'
```

## Anti-minták (mit NE csinálj)

- ❌ `echo '{"text":"...","ts":'$(date +%s.%N)'}' >> $JHT_AGENT_DIR/chat.jsonl` — felrobban idézőjeleken/`$`/emojikon, érvénytelen JSON-t produkál, a frontend csendben eldobja a sort.
- ❌ `cat << 'EOF' >> chat.jsonl ... EOF` — kikapcsolja a `$` interpolációt, az időbélyeg literális stringként marad.
- ❌ `python3 -c "import json; ..."` ad-hoc — ugyanolyan törékeny, mint a shell heredoc.
- ❌ Válaszolás `jht-tmux-send UTENTE ...`-vel — nincs `UTENTE` munkamenet. A felhasználó a webes frontenden él.
- ❌ A `[CHAT]` megválaszolása `jht-send`-del **és** ugyanannak a tartalomnak az újraküldése `jht-notify-user`-rel. Amióta a chat-sáv egységes, mindkettő UGYANABBA a beszélgetésbe ír: a felhasználó kétszer olvassa a válaszodat, és lejjebb senki nem távolítja el — a sáv nem tudja megkülönböztetni a duplikátumot két véletlenül egyező körtől. Egy üzenet, egy eszköz.
- ❌ Végső válasz küldése `--partial`-lal — a gépelési pontok a felhasználó képernyőjén ragadnak.
- ❌ Több `jht-send` hívás (`--partial` nélkül) aminek egy üzenetnek kellene lennie — minden nem-partial hívás külön buborékként jelenik meg.

## Küldés nem-alapértelmezett csatornára (ritka)

```bash
jht-send --agent capitano 'rendszerszintű megjegyzés a csatornámon keresztül irányítva'
```

Hasznos, amikor rendszerüzenetet akarsz naplózni a saját csevegési csatornádba (pl. egy automatizáció jelzi, hogy a felhasználó nevében cselekedett). Napi válaszokhoz soha nem kell ez a jelző.

## Miért `jht-send` és nem nyers shell

Történelem (ne ismételd meg): ágensek próbálkoztak `echo`-t-jsonl-be és `cat <<EOF` heredocokkal. Mindkettő törékeny módokban ért véget — az első felrobban idézőjeleken/`$`, a második az időbélyeget literális stringként fagyasztja le. Eredmény: érvénytelen JSON, amelyet a frontend kihagyott. A felhasználó semmit nem lát; te azt hiszed, válaszoltál. A `jht-send` eltávolítja a hibamódot teljesen — a törzs soha nem lép vissza egy shell parserbe az első szintű idézőjelezés után.

## Lásd még

- `tmux-send` — üzenetek **más ágenseknek** (más protokoll, más csatorna).
- `agents/assistente/assistente.md` — az Assistente-nek van a legmélyebb verziója ebből a protokollból (többlépéses onboarding folyamat kötelező ellenőrzési pontokkal); csak akkor olvasd, ha valaha átveszed az Assistente feladatait.
