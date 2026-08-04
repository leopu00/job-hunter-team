<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: notify-user
description: Értesítsd a felhasználót automatikus tartalékkal. Először Telegram-on próbál; ha a bot nincs konfigurálva / nem elérhető / rate-limited, az üzenet a webes dashboardra kerül felhő szinkronizáción keresztül. Mindig rögzíti az üzenetet a `pending_user_messages`-ben, hogy semmi ne vesszen el. Használd ezt, amikor állapotfrissítéssel, kérdéssel vagy összefoglalóval kell elérnod a felhasználót — soha ne hívd közvetlenül a `jht-telegram-send`-et erre a célra.
allowed-tools: Bash(jht-notify-user *)
---

# notify-user — egyetlen API a felhasználó eléréséhez

A felhasználónak több csatornája van (Telegram bot, webes dashboard, jövőbeli mobil push). Minden ágensnek nem kell tudnia, melyik él. A `jht-notify-user` eldönti:

1. INSERT-álja az üzenetet a `pending_user_messages`-be (jobs.db, V5 séma).
2. Best-effort küldés `jht-telegram-send`-en keresztül (~25 mp timeout).
3. Ha a Telegram sikeres → `delivered_via='telegram'`.
4. Ha sikertelen vagy nincs konfigurálva → `delivered_via='web'`. A sort a `jht cloud push` veszi fel és megjelenik a dashboardon a jobhunterteam.ai-n.

A felhasználó tehát minden üzenetet megkap valahol. Az ágensnek soha nem kell kezelnie a "Telegram leállt" ágakat.

## Mikor használd

- ✅ Capitano értesíti a felhasználót minden N kész pozíciónál (2026-05-13 döntés, kötegelt).
- ✅ Mentor heti összefoglaló / minta riasztások.
- ✅ Assistente kérdést tesz fel a felhasználónak, ami a bemenetet igényli.
- ✅ Bármilyen riasztás ("elfogyasztottam az ablak 95%-át, leállítsam a csapatot?").

## Mikor NE használd

- ❌ Ágensek közötti üzenetek — használd a `tmux-send` / `jht-tmux-send`-et.
- ❌ Válaszok `[CHAT]` üzenetre a webes dashboardon — használd a `jht-send`-et (már a csevegés szálban van).
- ❌ Válaszok `[TG]` bejövő üzenetre — használd közvetlenül a `jht-telegram-send`-et: már tudod, hogy a Telegram él, mert a felhasználó épp onnan írt neked. Megtakarít egy DB körutat.
- ❌ Nehéz csatolmányok (>20 MB). Használd a felhasználó CV mappáját + rövid értesítés törzs.

## Használat

```bash
# Sima értesítés a Capitano-tól
jht-notify-user --agent capitano "Trovate 10 offerte pronte sopra 75/100. Top: Acme Senior FE (88), Lever DevOps (84), …"

# Összefoglaló explicit típussal (a dashboardon fejléccel renderelődik)
jht-notify-user --agent mentor --kind digest "Settimana 19: 18 offerte analizzate, 4 candidate, gap principale: ruoli senior in EU remote."

# Kerdes — csak a felhasznalo altal mar kert jelentkezes tisztazasahoz
jht-notify-user --agent assistente --kind question "Az Acme Senior FE-hez mar kert jelentkezeshez melyik CV-verziot reszesited elonyben?"

# Pozícióhoz kötve (a pozíció kártyával renderelődik a dashboardon)
jht-notify-user --agent capitano --position-id 42 "CV pronto per posizione 42. Critic verdict: PASS."

# Web kényszerítés (Telegram megkerülés, teszthez vagy üzenetekhez, amelyeknek csak dashboard kontextusban van értelmük)
jht-notify-user --agent mentor --no-telegram "Apri il tab Patterns per i dettagli."
```

Kimenet (stdout):
```
<row_id> via=<telegram|web>
```

## Típusok

| Típus | Mikor | Dashboard renderelés |
|------|--------|---------------------|
| `notification` | Általános állapotfrissítés (alapértelmezés) | Szürke kártya |
| `question` | A felhasználónak válaszolnia kell, mielőtt az ágens tovább haladna | Kártya válasz bemenettel |
| `digest` | Periodikus összefoglaló (Mentor heti, Capitano kötegelt) | Összecsukható kártya |
| `alert` | Blokkoló anomália (rate limit, jelölés kézbesítési hiba) | Piros kártya |

## Tartalék útvonal

```
ágens ──► jht-notify-user
              │
              ├──► INSERT pending_user_messages (delivered_via=NULL, kind, body)
              │
              ├──► try jht-telegram-send (25s timeout, best-effort)
              │
              │      ┌─ sikeres ─► UPDATE delivered_via='telegram'
              │      │
              │      └─ sikertelen/timeout/nem konfigurált ─► UPDATE delivered_via='web'
              │
              └──► stdout: "<id> via=<channel>"

                              ▼ (külön folyamat, cloud-sync daemon)

         jht cloud push  ──► /api/cloud-sync/push  ──► Supabase
                                                          │
                                                          ▼
                                          dashboard /(protected)/dashboard
                                          mutatja a még nem ack-olt üzeneteket
```

## Hibamódok

| Kilépés | Ok | Helyreállítás |
|------|-------|----------|
| 0 | Sor beszúrva; kézbesítés best-effort (lásd `via=` stdout-on) | — |
| 1 | Érvénytelen argumentumok (üres törzs, --kind ismeretlen) | Javítsd a jelzőket |
| 2 | DB nem található vagy INSERT sikertelen | Ellenőrizd a `$JHT_DB` / `$JHT_HOME/jobs.db`-t; a sémának V5+ kell lennie |

A 0 kilépés `via=web`-vel NEM hiba: ez a várt viselkedés, ha a Telegram nem aktív. Az üzenet biztonságban van a sorban.

## Jelölő prompt-injekció (2026-05-13 döntés § 6)

Amikor a felhasználó válaszol a dashboardon (kitölti a `user_reply`-t egy `delivered_via='web'` soron), neked kell elolvasnod azt a választ — a Telegram nem fog látni semmit. Ehhez használd a **`user-reply-check`** skill-t a ciklus minden iterációjában: visszaadja a felhasználó válaszait a dashboardon és megjelöli őket látottként, hogy ne dolgozd fel kétszer. Amikor válaszolsz, használd a `jht-notify-user --no-telegram`-ot, hogy a web csatornán maradj (egy webes beszélgetés visszhangozása Telegram-on zavarja a felhasználót).

## Lásd még

- `user-reply-check` — a minta másik fele. Olvasd a dashboardon érkezett válaszokat a ciklusodban.
- `telegram-send` — a `jht-notify-user` hívja a háttérben; csak akkor használd közvetlenül, ha már tudod, hogy a Telegram a helyes csatorna (pl. `[TG]` bejövőre válasz).
- `chat-web` (`jht-send`) — az ágens-csevegés szálhoz a dashboardon.
- `agents/_manual/db-schema.md` § `pending_user_messages` — sor séma + indexek.
