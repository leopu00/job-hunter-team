<!-- @translation: hu, ai-translated 2026-09-13 -->
---
name: apply-flow
description: Hogyan futtatja a CLOSER egy engedélyezett jelentkezést az `apply_flow.py`-jal — a checkpointos állapotgép (detect, fill, upload_cv, screening, review, submit), a kötelező nyugta, amely nélkül az `applied` soha nem íródik be, és mit kell tenni az egyes eredményeknél, mindenekelőtt `blocked_human` esetén. Használd minden, a queue-ból felvett pozícióhoz. A CLOSER-é.
allowed-tools: Bash(python3 /app/shared/skills/apply_flow.py *), Bash(python3 /app/shared/skills/application_answers.py *), Bash(python3 /app/shared/skills/db_query.py *)
---

# apply-flow — egy jelentkezés, egy nyugta, nincs vak újrapróbálás

```bash
python3 /app/shared/skills/apply_flow.py \
  --position-id "$PID" \
  --url "$URL" \
  --profile "$JHT_HOME/profile/candidate_profile.yml" \
  --cv "$CV"
```

A `PID`, `URL` és `CV` az `apply_gate.py queue` legutóbbi olvasásából jön (skill
`apply-authorization`), soha nem a memóriából.

## Az állapotgép

```
detect → fill → upload_cv → screening → review → submit → applied
                                                        ↘ blocked_human
```

- Minden befejezett lépés checkpointba mentődik (`$JHT_HOME/.cache/apply-flow/<id>.json`).
  Összeomlás után a folyamat ott folytatja: a kitöltés megismétlődik, a kattintás nem.
- A `submit_started` a kattintás **előtt** mentődik. Ha egy folyamat e sor után hal
  meg, az eredmény ismeretlen, és ismeretlen eredményre soha nem kattint újra: a
  folyamat megerősítést keres az oldalon, és ha nincs, `submit_outcome_unknown`-nal
  blokkol.
- A kapu induláskor **és** közvetlenül a kattintás előtt is ellenőrződik. Egy flag,
  amelyet az űrlap kitöltése közben vontak vissza, leállítja a beküldést.
- Ma két teljes recept van: **Ashby** és **Greenhouse** (csak a három nyilvános hostja, `job-boards.greenhouse.io`, `job-boards.eu.greenhouse.io`, `boards.greenhouse.io`, HTTPS-en; az oldalt minden lépés után újra ellenőrzi). Minden más platform emberre vár.

## A nyugta

Az `applied` csak akkor íródik be, ha a folyamatnak **mindkettő** megvan:

1. egy képernyőkép a megerősítő oldalról, és
2. egy megerősítő URL vagy szöveg.

Ezután maga a folyamat rögzíti a jelentkezést `applied_via = agent_closer` értékkel,
és visszaolvassa a sort, hogy ellenőrizze, megtörtént-e az írás. Ezt az állapotot
senki más nem írja: sem te, sem a Capitano.

## Az eredmény olvasása

Egy JSON sor a stdout-on: `status`, `state`, `reason`, `receipt`.

| `status` | Exit | Jelentés | Teendőd |
|---|---|---|---|
| `applied` | 0 | elküldve, nyugta mentve, állapot rögzítve | következő pozíció |
| `dry_run` | 0 | `mode: dry_run`: kitöltve, a gomb előtt megállt, semmi nem ment ki | következő pozíció |
| `denied` | 1 | a kapu elutasította (hozzájárulás kikapcsolva, flag visszavonva, már elküldve) | következő pozíció; soha ne próbáld újra |
| `blocked_human` | 3 | ember kell; a felhasználó már értesítést kapott | következő pozíció; soha ne próbáld újra |
| `blocked_human` válaszokra vár (`essential_facts_missing`, `required_answer_missing`, `required_profile_field_missing`, `required_field_unanswered`) | 3 | nem végleges megállás: a felhasználót egyszer megkérdezték, a queue tartja a pozíciót (`essential_answers_pending` / `checkpoint_blocked_human`), amíg a válaszok a `jobs.db`-ben vannak, kérdésenként legfeljebb egy napig (legfeljebb kétszer kérdezve, utána a folyamat továbbmegy) | következő pozíció; a `[BRIDGE INFO]`-ra, amely szerint a felhasználó válaszolt, olvasd újra a queue-t: a pozíció újra a `positions` között van |
| `email_channel` | 4 | a jelentkezési elem egy `mailto:` link, nem űrlap; a checkpoint tartalmazza a `channel: email` értéket és a nyers `mailto_href`-et | ennél a pozíciónál futtasd az `email_application.py send` parancsot az `email-application-flow` skill szerint: ez a checkpointot olvassa; soha ne tölts ki webes űrlapot, és ne írd kézzel az e-mailt |
| `error` | 2 | olvashatatlan profil vagy CV, hibás argumentumok | állj meg: `[BLOCKED]` a Capitanónak |

## `blocked_human` — mit jelent és mit teszel

A folyamat megáll mindennél, amit nem tud biztosan elvégezni:

| `reason` (példák) | Tipikus ok |
|---|---|
| `required_answer_missing` / `required_profile_field_missing` / `required_field_unanswered` | egy kötelező mezőnek nincs mentett válasza — a felhasználót egyszer megkérdezték (először Telegramon, a dashboardon is); a válasz a `jobs.db`-be kerül, és a folyamat a checkpointtól folytatódik |
| `essential_facts_missing` / `essential_facts_unavailable` | egy pozíció első futása előtt hiányzik egy adat, amit szinte minden űrlap kér (kezdési dátum, felmondási idő, munkavállalási engedély, sponsorship, bér, költözés, telefon); mindegyiket egyszer megkérdezték, és semmi sincs visszatartva: a pozíció újra fut, amint a válaszok megvannak |
| `captcha` / `two_factor` | az oldal ellenőrizni akarja, hogy ember van-e ott |
| `unknown_required_control` / `answer_type_unknown` / `answer_option_unknown` / `answer_not_accepted` | egy mező, amelyet a recept nem tud mentett válasszal kitölteni |
| `upload_rejected` / `resume_field_missing` / `cv_missing` | a CV nem csatolható |
| `ats_unsupported` / `ats_conflict` / `ashby_dom_unrecognised` / `greenhouse_dom_unrecognised` / `ashby_form_missing` / `ashby_apply_ambiguous` / `greenhouse_form_missing` / `greenhouse_form_ambiguous` | ehhez az oldalhoz még nincs recept, vagy az űrlap nem az, amelyet a recept ismer |
| `greenhouse_redirect_untrusted` | a folyamat közben a Greenhouse oldal kilépett a három megbízható hostjából |
| `mailto_ambiguous` / `mailto_invalid` / `application_form_ambiguous` / `application_field_outside_form` / `submit_outside_form` | két különböző mailto jelentkezési cím, vagy a jelentkezési űrlap, a mezői vagy a küldés gombja nem köthető egyetlen űrlaphoz (hírlevél, lábléc és demó űrlap soha nem része) |
| `form_error` / `field_invalid` / `submit_unavailable` | az űrlap hibát jelez, egy mező formátumát elutasítja, vagy a beküldés gomb hiányzik vagy le van tiltva |
| `url_refused` / `checkpoint_invalid` | a jelentkezési URL nem ment át a nyilvános címek ellenőrzésén, vagy a mentett checkpoint olvashatatlan |
| `page_unavailable` / `browser_uncertainty` | az oldal vagy a böngésző a folyamat közepén hibázott |
| `receipt_missing` / `receipt_incomplete` / `confirmation_ambiguous` | a beküldésre rákattintott, de a megerősítés nem biztos |
| `receipt_screenshot_failed` | a megerősítés látható volt, de a képernyőképét nem sikerült menteni |
| `submit_outcome_unknown` | egy korábbi futás elindította a beküldést és nem hagyott nyugtát |
| `applied_record_failed` | a nyugta létezik, de az állapotot nem sikerült rögzíteni — a jelentkezés szinte biztosan kiment |

Mit teszel, mindig ugyanazt:

1. **Semmit azzal a pozícióval.** A folyamat már megírta a checkpointot és a
   `jht-notify-user`-rel értesítette a felhasználót. Ne értesítsd újra.
2. **Ne próbáld újra.** Se most, se „még egyszer pár perc múlva". A queue
   visszatartja (`checkpoint_blocked_human`), amíg a felhasználó újra nem engedélyezi.
3. **Lépj a queue következő pozíciójára.**

Egy blokkolt pozíció újrapróbálása éppen az a vak próbálkozás, amelynek
megakadályozására ez a design létezik: captchánál leégeti a felhasználó fiókját,
ismeretlen eredménynél második levelet küld ugyanannak a recruiternek.

## Egy jelentkezés utólagos ellenőrzése

```bash
python3 /app/shared/skills/db_query.py application "$PID"
```

`applied_via: agent_closer` és egy nem üres `applied_at` = a folyamat rögzítette.
