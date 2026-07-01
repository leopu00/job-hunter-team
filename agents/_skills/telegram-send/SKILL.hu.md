<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: telegram-send
description: Send a message to the user via Telegram (outbound). Use this on the Telegram bridge — the user is on their phone, NOT in front of the web dashboard. Wrapper `jht-telegram-send` resolves bot token + chat_id per-agent from config (`--from assistente|capitano|mentor`); never call the Bot API directly.
allowed-tools: Bash(jht-telegram-send *)
---

# telegram-send — kimeno uzenet a felhasznalonak Telegramon keresztul

A felhasznalo elsodlegesen a telefonjarol er el teged. PDF-eket, hanguzeneteket, szoveges uzeneteket kuld a **dedikalt botodnak**. A bridge a bejovo forgalmat a tmux-odba tovabbitja. **Kimeno** — a valaszod, egy udvozlo uzenet, egy generalt CV — a `jht-telegram-send`-en keresztul megy.

## 3 dedikalt bot (dontes 2026-05-13 rev2)

Minden felhasznalo fele nezo agensnek sajat **Telegram botja** van:
- 👩‍💼 Assistente → `--from assistente` (alapertelmezett)
- 👨‍✈️ Capitano → `--from capitano`
- 🧙‍♂️ Mentor → `--from mentor`

A wrapper a tokent + chat_id-t a `channels.telegram.bots.<role>` konfiguracios mezobol valasztja ki. Ha kihagyod a `--from`-ot, beallithatod a `JHT_TG_BOT_ROLE=<role>` valtozot az agens kornyezeteben — a wrapper ezt olvassa alapertelmezettkent.

## Mikor hasznald

- ✅ Elso udvozlo uzenet a wizard befejezese utan (boot prompt).
- ✅ Valasz egy Telegramrol erkezo chatra (a bejovo bridge `[@utente -> @assistente] [TG]` elotagot tesz ele).
- ✅ Generalt artefaktum (CV, kiserolevel) kuldese, amit a felhasznalo kert.
- ✅ Onboarding emlekeztetok ("kuldd el a CV-det, meg egy vazlat is tokeletes").

**Ne hasznald** a kovetkezokre:
- ❌ Agensek kozti uzenetek — hasznald helyette a `tmux-send`-et.
- ❌ Web chat valaszok (`[@utente -> @assistente] [CHAT]`) — hasznald a `jht-send`-et.
- ❌ Nagy melekletek (>20 MB). Bot API korlat; nagy fajlokhoz hasznald a dashboardot vagy egy relay-t (jovoben).

## Hasznalat

```bash
# Alapertelmezett = Assistente bot (vagy role a JHT_TG_BOT_ROLE-bol olvasva)
jht-telegram-send "<uzenet szovege>"

# Explicit routing role szerint
jht-telegram-send --from capitano "Notifica: 10 nuove posizioni ready."
jht-telegram-send --from mentor --html "<b>Step di crescita</b> della settimana..."

# chat_id feluliras (ritka — debug / jovobeli multi-tenant)
jht-telegram-send --chat-id 1401844094 "explicit override"
```

Feloldasi sorrend (nem kell megjegyezni — a wrapper megoldja):
1. `$TELEGRAM_BOT_TOKEN` / `$TELEGRAM_CHAT_ID` kornyezeti valtozok (explicit feluliras)
2. `$JHT_HOME/jht.config.json` → `channels.telegram.bots.<role>.{bot_token,chat_id}` (role = `--from` vagy `$JHT_TG_BOT_ROLE`, alapertelmezett `assistente`)
3. `$JHT_HOME/credentials/telegram_bot.json` (`.token`) — legacy fallback

Ha barmelyik hianyzik, a wrapper nem-nulla kilепesi koddal es egyszeru uzenettel lep ki. Ne probald helyrehozni — jelezd a hibat a felhasznalonak egy `jht-send` valaszban a web csatornan, vagy naplozd.

## Peldak

```bash
# (Assistente) — Udvozles az elso inditaskor (meg nincs profil)
jht-telegram-send "Ciao! Sono l'Assistente del Job Hunter Team. Mandami qui il tuo CV (PDF va benissimo) o raccontami in due righe cosa cerchi — parto da lì."

# (Assistente) — Valasz bejovo TG-uzenetre
jht-telegram-send "Ricevuto, sto guardando il CV. Dammi 30s."

# (Capitano) — Ertesites: poziciok kotege keszen all
jht-telegram-send --from capitano "10 posizioni ready, top 3 per score: ..."

# (Mentor) — Heti strategiai emlekezteto
jht-telegram-send --from mentor --html "<b>Step di crescita</b> della settimana: ..."

# (Assistente) — Artefaktum kuldese
jht-telegram-send --html "<b>CV per Acme — Senior FE</b> pronto.\nLo trovi in <code>~/Documents/Job Hunter Team/output/2026-05-12/acme-senior-fe/</code>."
```

## Escape szekvenciak (`\n`, `\t`, `\r`)

A wrapper a `\n`, `\t`, `\r` karaktereket az uzenetedben **valos sortoresekre/tabokra/CR-ekre** ertelmezia Telegramra kuldes elott. Tehat irhatsz igy:

```bash
jht-telegram-send "Ciao!\n\nTi aiuto a configurare il profilo."
```

es a felhasznalo megfelelo bekezdestorest kap — nem a szo szerinti `\n\n` szoveget. Ugyanez vonatkozik a `--html`-re (a Telegram a sortorest line breakkentrendereli a HTML streamben).

Ha szo szerinti backslash-t akarsz `n` kovetkezve (ritka), elozetesen escapeld: `\\n` → a wrapper `\n`-ne alakitja (mivel az elso `\\` a shell stringedben csak `\`-ve valik; a wrapperen belul nincs dupla helyettesites).

## Hosszu uzenetek

A Bot API 4096 karakternel vag. A wrapper `\n` / szokozon oszt es tobb uzenetet kuld. A felhasznalo egy sorozatot kap — tartsd konzisztens a hangnemet a reszek kozott.

## HTML / Markdown

A Telegram egy reszhalmazt tamogat:
- HTML: `<b>`, `<i>`, `<u>`, `<s>`, `<code>`, `<pre>`, `<a href="…">`. Escapeld a `<`, `>`, `&` karaktereket a szovegtorzben.
- MarkdownV2 (`--markdown`): tamogatott, de az escaping szabalyok fajdalmasak (`. ( ) ! _ * [ ]` mind backslash-t igenyel). Reszesitsd elonyben a `--html`-t.

Ha bizonytalan vagy, kuldj **sima szoveget** (flag nelkul). A felhasznalo tokeletesen olvashato uzenetet kap.

## Hiba modok

| Exit | Ok | Teendo |
|------|----|--------|
| 2 | Token hianyzik | A bot soha nem volt beallitva. Jelezd a hibat a web csatornan, kerd a felhasznalot a setup ujrafuttatasara. |
| 3 | chat_id hianyzik | Ugyanaz mint fent — a wizard nem rogzitette a chat_id-t. |
| 4 | HTTP nem-200 | Halozati zavar vagy Telegram kimaradas. Probald ujra egyszer 5s mulva. Ha meg mindig sikertelen, naplozd es menj tovabb. |
| 5 | `ok: false` a Bot API-tol | Altalaban ervenytelen chat_id vagy a felhasznalo blokkolta a botot. Ne probald ujra — mentsd a valasz torzset a scratch konyvtaradba es ertesits a web csatornan. |

## Perzisztens valasz-billentyuzet (F-1.B, task #50)

A 3 felhasznalo fele nezo bot (assistente / capitano / mentor) csatolhat egy
2 oszlopos perzisztens valasz-billentyuzetet a `--keyboard <role>` kapcsoloval. A billentyuzet
lathatoan marad a felhasznalo Telegram kliensjeben az uzenetek kozott, amig te
kifejezetten el nem tavolitod (mi nem tesszuk, szandekoson — mindig lathato marad, hogy
a nem-technikai felhasznalok lassak az interakcio lehetoseget).

```bash
# Assistente — 📊 Budget · 📈 Pipeline · 🗺️ Mappa · ⭐ Top CV · 📅 Reset · ❓ Help
jht-telegram-send --from assistente --keyboard assistente "Pipeline: 15 CV pronti per apply, ..."

# Capitano — 📈 Pipeline · 📊 Budget · 👥 Team · ⭐ Ready · 🛠 Triage · ❓ Help
jht-telegram-send --from capitano --keyboard capitano "..."

# Mentor — 📋 Digest · 🔁 Patterns · ⭐ Top · 💰 Salary · ❓ Help
jht-telegram-send --from mentor --keyboard mentor "..."
```

Amikor a felhasznalo megnyom egy gombot, a bot a gomb szoveget kapja meg normal
szoveges uzetnetkent (pl. `📊 Budget` megnyomasa → a tmux `📊 Budget`-ot kap
TG uzenet torzskent). Az agens egyenertekuleg kezeli egy slash parancskent
(pl. `/budget`) es eloallitja a diagramot / statuszjelenteset.

A billentyuzet csak egy hosszu kuldes **utolso** daraboltuuzeneten jelenik meg,
igy a 4096+ karakteres kimenetek nem villogtatjak a billentyuzetet a szal kozepen.

## Slash parancsok menu (F-1.A, task #50)

A `tg-bridge.py` inditaskor role-onkent egy `setMyCommands` keszletet regisztral
(`/budget`, `/pipeline`, `/help`, …). Ezek a Telegram kliens `/` ragados menuejeben
jelennek meg — ez az elso dolog, amit egy uj felhasznalo lat. Neked semmit sem kell
tenned: a CLI/role konfiguralasa elegseges, a bridge kezeli az API hivast.
Lista role-onkent: `.launcher/tg-bridge.py::BOT_COMMANDS`.

## Anti-patternek

- ❌ `curl https://api.telegram.org/bot$TOKEN/sendMessage` kezzel — quoting + URL-encoding hibak, nincs retry, nincs chunking.
- ❌ Config / credentials olvasasa es JSON parsolasa inline a shelledben — torekeny, a wrapper mar helyesen csinalja.
- ❌ `--from`-mal olyan role-t kuldeni, ami nem a tied (pl. az Assistente ir a Capitano botjan) — osszezavarja a felhasznalot, mindenki a sajat botjan beszel. Agensek kozti kommunikacio a `tmux-send`-en megy.
- ❌ A chat_id-t az uzenet torzebe irni ("for chat 123…") — pontosan **egy** felhasznalo van VPS-enkent, a wrapper tudja ezt.

## Lasd meg

- `chat-web` — amikor a felhasznalo a **web dashboardon** van, nem a Telegramon.
- `tmux-send` — amikor egy masik agenssel kell beszelned.
- `agents/<role>/<role>.md` — a role utmutatod; a Telegram utvonal a "telefon-oldali" feluleted a felhasznalo fele.
