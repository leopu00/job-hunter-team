<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: user-reply-check
description: Beolvassa a felhasznalo valaszait, amelyek a webes dashboardon keresztul erkeztek (tartalek csatorna, amikor a Telegram nem mukodott/nem volt konfiguralna). Futtasd minden ciklus-iteracio elejen. Az eszkoz visszaadja a NEM LATOTT valaszokat a TE agensednek, es megjeloli oket latottnak, igy nem dolgozod fel oket ketszer. Ez a notify-user minta "marker prompt-injection" fele (dontes 2026-05-13).
allowed-tools: Bash(jht-check-user-replies *)
---

# user-reply-check — a webes dashboardon keresztul kuldott felhasznaloi valaszok atvetele

A felhasznalo ket helyrol valaszolhat a `notify-user` uzeneteidre:

1. **Telegram** — a telefonjarol valaszol; a `tg-bridge` beinjektalja az uzenetet a tmux-odba mint `[@utente -> @<agente>] [TG] <body>`. Inline latod. **Itt nincs teendo.**
2. **Webes dashboard** — amikor `delivered_via='web'` (a Telegram nem mukodott/nem volt konfiguralna), a felhasznalo a dashboard kartyan gepeli be a valaszat. A szoveg a `pending_user_messages.user_reply`-ba kerul. A Telegram NEM latja. **Itt lep mukodes be ez a skill.**

`user-reply-check` nelkul a dashboardrol erkezett valaszok orokre csendben ulnenek az adatbazisban.

## Mikor hasznald

- ✅ Minden ciklus-iteracio elejen (Capitano: tickenkent egyszer; Mentor: session ebredeskent egyszer; Assistente: felhasznaloi input ciklusok kozott).
- ✅ Kozvetlenul a `notify-user` futtatasa utan, ha `kind=question`-t tettel fel — valoszinu, hogy a felhasznalo mar valaszolt, ha eltelt nemi ido.
- ✅ Amikor a felhasznalo emliti, hogy "ti ho risposto sulla dashboard", de te nem lattal semmit Telegramon keresztul.

## Mikor NE hasznald

- ❌ Bejovo Telegram uzenetekhez — a `tg-bridge` kezeli; kozvetlenul latod a `[TG] …`-t.
- ❌ Polling cikluskent munka nelkul kozben — ez egy ellenorzes, nem egy watcher. Minden hivas egy konnyu DB lekerdezes, de tokeneket pazarolnal a "nincs valasz" 100-szori olvasasaval.

## Hasznalat

```bash
# Standard hivas a ciklus elejen (az osszes visszaadott valaszt latottnak jeloli)
jht-check-user-replies --agent <your_agent_id>

# Felhasznalat nelkul (debug / mielott biztos lennel, hogy ack-olni akarod)
jht-check-user-replies --agent <your_agent_id> --peek

# Strukturalt kimenet a gondolatmenetedbe valo betaplalashoz
jht-check-user-replies --agent <your_agent_id> --json
```

A `<your_agent_id>`-nek meg kell egyeznie a `jht-notify-user`-ben hasznalt `--agent` ertekkel. Minden agensnek sajat sora van — a Capitano valaszai soha nem jelennek meg a Mentornak.

## Kimenet

Ures kimenet = nincs semmi uj szamodra. Kezeld csendes no-op-kent es folytasd a ciklusodat.

Nem ures kimenet (emberi formatumban):

```
[USER REPLY via WEB — id=42] Usa la versione breve del CV, grazie.
    ↳ in risposta a: "Per la candidatura gia' richiesta per Acme Senior FE, quale versione del CV preferisci?"
    ↳ kind=question created=2026-05-13 12:00:00 reply_at=2026-05-13 14:30:00
```

JSON formatum (`--json`):

```json
[
  {
    "id": 42,
    "agent": "capitano",
    "body": "Per la candidatura gia' richiesta per Acme Senior FE, quale versione del CV preferisci?",
    "kind": "question",
    "related_position_id": 17,
    "user_reply": "Usa la versione breve del CV, grazie.",
    "user_reply_at": "2026-05-13 14:30:00",
    "created_at": "2026-05-13 12:00:00"
  }
]
```

## Hogyan valaszolj

A felhasznalo a **webes dashboardon** nyitotta meg a beszelgetest, nem a Telegramon. Arra szamit, hogy a valaszod is ott jelenik meg. Tehat:

1. Hivd meg a `jht-notify-user --agent <your_id> --no-telegram "<reply>"`-t. A `--no-telegram` flag fontos — kikenyszeriti a `delivered_via='web'`-et, igy a valasz ugyanabba a csatornaba kerul, amit a felhasznalo eppen olvas.
2. Opcionalisan add meg a `--position-id <N>`-t, ha az eredeti uzenetnek volt ilyen (ugyanaz a pozicio, ugyanaz a kontextus).
3. **NE** kuld el a valaszt `jht-telegram-send`-en keresztul is. A felhasznalo ertesitest kapna a telefonjara egy olyan beszelgetesrol, amelyet a bongeszojeben folytat — zavaro es zajos.

Ha a valasz egyszeru visszaigazolas ("ok, ricevuto"), akr ki is hagyhatod az uj uzenetet: az `acknowledged_at` mar be lett allitva, amikor a felhasznalo begeelte a valaszt, igy a felhasznalo tudja, hogy megkaptad, amint megjelolod az `agent_seen_reply_at`-ot (ez a skill ezt automatikusan megteszi).

## Idempotencia

Minden `--peek` nelkuli hivas frissiti az `agent_seen_reply_at = CURRENT_TIMESTAMP` erteket minden visszaadott sorhoz. A kovetkezo hivas nem ad vissza semmit (amig uj valasz nem erkezik). Ha osszeomolsz a kimenet olvasasa es a cselekvs kozott, a valasz MEG VAN jelolve latottnak — nincs automatikus ujrakezbesites. Hasznald a `--peek`-et diagnosztikai futatasokhoz, ahol nem akarsz fogyasztani.

## Kesleltetés

A valasz ennyi idot vesz igenybe:
- **Helyi mod**: ~0 (a dashboard kozvetlenul SQLite-ba ir a `/api/pending-messages/[id]/reply`-n keresztul).
- **Felho mod (VPS)**: a cloud-sync daemon `--interval` masodperceig. Alapertelmezetten 30s. Ne szamits masodperc alatti valaszidore VPS-en.

Ha a felhasznalo panaszkodik, hogy "10 masodperce valaszoltam es meg nem igazoltad vissza," ellenorizd a `jht cloud status`-t — valoszinuleg VPS-en van es a pull-ra var.

## Anti-mintak

- ❌ Polling szoros ciklusban (`while true; jht-check-user-replies; sleep 1`). Hasznald a meglevo agens-ciklusod termeszetes ritmusat.
- ❌ Rossz `--agent` ertekkel hivas (pl. a Capitano `--agent mentor`-t hiv). Mas valaszait fogyasztanad el, es a jogos tulajdonos lemaradna roluk.
- ❌ A kimenet figyelmen kivul hagyasa. Ha valasz erkezik, reagalj ra — minimum kuld el a `notify-user --no-telegram "Ricevuto, sto elaborando."`-t, hogy a felhasznalo tudja, az uzenet megerkezett.

## Lasd meg

- `notify-user` — a par masik fele. Az uzenetet a `pending_user_messages`-be irja; ez a skill olvassa vissza a valaszt.
- `agents/_manual/db-schema.md` § `pending_user_messages` — schema, indexek, egy sor eletciklusa.
