<!-- @translation: hu, ai-translated 2026-09-13 -->
---
name: email-application-flow
description: Hogyan küld el a CLOSER egy engedélyezett jelentkezést e-mailben az `email_application.py`-val, amikor az `apply_flow.py` `email_channel` választ ad (az Apply vezérlő egy `mailto:` link) — inspect, preflight, draft, send, status; a gate újraellenőrzése közvetlenül a küldés előtt; `send_started` a visszafordíthatatlan parancs előtt; a nyugta, amely nélkül az `applied` soha nem íródik be. Használd minden olyan pozíciónál, amelynek folyamata `email_channel`-lel ér véget. A CLOSER-é.
allowed-tools: Bash(python3 /app/shared/skills/email_application.py *)
---

# email-application-flow — egy e-mail, egy nyugta, nincs vakon újrapróbálás

**Csak** a legutóbbi queue olyan pozíciójánál használd, amelynél az
`apply_flow.py` `email_channel` választ adott (exit 4). A böngészős folyamat a
nyers `mailto_href`-et a checkpointjában hagyta; ez a skill azt olvassa. Soha nem
nyitsz levelezőprogramot, soha nem írsz kézzel e-mailt, és a címet sehová nem másolod.

```bash
python3 /app/shared/skills/email_application.py send --position-id "$PID" --json
```

A `send` mindent sorban lefuttat, és az első problémánál megáll. A többi parancs
olvasásra való, nem egy megállás kijátszására:

| Parancs | Mit csinál |
|---|---|
| `inspect` | beolvassa és értelmezi a mailto linket (To, CC, tárgy, szöveg) |
| `preflight` | inspect + gate + napi limit + küldés + CV + motivációs levél + kötelező adatok |
| `draft` | preflight + a determinisztikus vázlat; semmi nem megy ki |
| `send` | draft + ismét a gate + `send_started` + küldés + nyugta + `applied` |
| `status` | az utolsó kísérlet és állapota, csak olvasás |

A `--dry-run` a küldés előtt megáll, és a jelentkezésen semmit nem változtat.

## Mit garantál a parancs

- **A flag maga az engedély.** A gate a preflightban dönt, és újra közvetlenül a
  küldés előtt. Ha közben visszavonták a flaget vagy elérték a limitet, semmi nem
  megy ki (`denied`).
- **Semmi nincs kitalálva.** A címzettek csak a linkből jönnek. A név, a
  kapcsolattartó e-mail és minden adat, amit a hirdetés kér (kezdési időpont,
  bérigény), csak a jelölt profiljából jön; ha valamelyik hiányzik, az
  `required_fact_missing`.
- **A CV mindig csatolva van**, a méret, a PDF és a hash ellenőrzése után.
  Motivációs levelet csak akkor csatol, ha a hirdetés kéri; ha nincs, a
  Scrittore-tól kéri a szokásos írási kéréssel, és a folyamat megáll.
- **Legfeljebb egy levél.** A `send_started` még azelőtt rögzül, hogy a szerver
  megkapná az üzenetet. Utána egy timeout vagy nem egyértelmű válasz
  `send_outcome_unknown`: soha nem próbálja újra, egy új futás sem.
- **`applied` csak elfogadás után**, `applied_via = agent_closer_email` értékkel,
  magát a parancs írja be, miután a nyugtát elmentette.

## Az eredmény olvasása

Egy JSON sor: `state`, `reason`, `detail`, plusz adatok.

| `state` | Exit | Jelentés | Mit teszel |
|---|---|---|---|
| `sent` | 0 | a szerver elfogadta, nyugta mentve, jelentkezés rögzítve | következő pozíció |
| `draft_ready` | 0 | dry run: vázlat és mellékletek érvényesek, semmi nem ment ki | következő pozíció |
| `denied` | 1 | a gate elutasította (`flag_revoked`, `gate_mode_changed`, `daily_cap_reached`, `duplicate_attempt`) | következő pozíció; soha ne próbáld újra |
| `blocked_human` | 1 | ember kell hozzá; a leállás a kör összefoglalójában van | következő pozíció; soha ne próbáld újra |
| `send_outcome_unknown` | 3 | az e-mail lehet, hogy kiment | következő pozíció; soha ne próbáld újra |
| `receipt_incomplete` | 3 | elfogadva, de a nyugta vagy a rögzítés hiányos; ha csak egyes címzetteket utasítottak el, a levél valószínűleg megérkezett | következő pozíció; soha ne próbáld újra |
| `error` | 2 | az adatbázis, a profil vagy a checkpoint olvashatatlan | megállás: `[BLOCKED]` a Capitanónak |

⚠️ Ezek az exit kódok **nem** azonosak az `apply_flow.py` kódjaival (ott a `denied` 1,
a `blocked_human` 3). A `state` alapján dönts, soha ne a szám alapján.

## A `blocked_human` okai

| `reason` | Tipikus ok |
|---|---|
| `transport_missing` | nincs beállított e-mail küldés, vagy a titokfájl hiányzik vagy nem 0600 |
| `auth_failed` | a levelezőszerver elutasította a hitelesítő adatokat |
| `sender_unverified` | a feladó címe se nem a hitelesített fiók, se nem ellenőrzött feladó |
| `mailto_missing` | ehhez a pozícióhoz nincs `email_channel` állapotú böngészős checkpoint: előbb futtasd az `apply_flow.py`-t; az oldalt soha nem olvassa címért |
| `recipient_ambiguous` / `mailto_invalid` | nulla vagy több címzett, tiltott fejléc, CR/LF egy fejlécben; idézőjeles local part és nemzetközi (IDN) cím is, ezek nem támogatottak |
| `recipient_refused` | a szerver elutasította a címzetteket, mielőtt bármi kiment volna: egy új próbálkozás, miután a felhasználó lépett, nem duplikátum |
| `required_fact_missing` | a hirdetés olyan adatot kér, amit a profil nem tartalmaz |
| `cv_missing` | nincs olvasható PDF CV ehhez a jelentkezéshez |
| `cover_letter_required` | a hirdetés motivációs levelet kér; a Scrittore-t megkérték |

Mit teszel, mindig ugyanazt:

1. **Semmit azon a pozíción.** A parancs betette a leállást a kör összefoglalójába (`closer_notices.py flush` a STEP 6-ban).
2. **Ne próbáld újra.** A queue visszatartja (`email_blocked_human`,
   `email_send_outcome_unknown`, ...), amíg a felhasználó nem lép.
3. **Lépj a queue következő pozíciójára.**

## Soha

- ne küldj e-mailt más módon, mint ezzel a paranccsal;
- ne futtasd a `send`-et olyan pozíción, amely nincs a legutóbbi queue-olvasásban;
- ne próbáld újra `send_started`, `send_outcome_unknown` vagy `receipt_incomplete` után;
- ne írd be magad az `applied`, `applied_via` vagy `apply_requested` értéket;
- ne illeszd be az SMTP jelszót, és ne kérd el a felhasználótól a chatben.

## Utólagos ellenőrzés

```bash
python3 /app/shared/skills/email_application.py status --position-id "$PID" --json
```

`state: sent` egy `message_id`-vel = a parancs rögzítette az e-mailes küldést.
