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
- Ma három teljes recept van: **Ashby**, **Greenhouse** (csak a három nyilvános hostja, `job-boards.greenhouse.io`, `job-boards.eu.greenhouse.io`, `boards.greenhouse.io`, HTTPS-en; az oldalt minden lépés után újra ellenőrzi) és **Lever** (csak `jobs.lever.co` és `jobs.eu.lever.co`, HTTPS-en, ugyanígy újraellenőrizve). LinkedIn: a „jelentkezés a cég oldalán” azon az oldalon folytatódik a saját receptjével; az Easy Apply a felhasználó fiókjával jelentkezik be (a munkamenet megmarad, ellenőrző kód Telegramon) és kitölti az ablakot. Minden más platform emberre vár.

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
| `blocked_human` hiányzó válaszok (`essential_facts_missing` a `missing`-gel, `required_answer_missing` a `pending_question`-nel) | 3 | nem megállás, és semmit nem kérdeztek: a folyamatnak hiányoznak válaszok | mindegyiket következtesd ki a profilból, a CV-ből és a hirdetésből, és mentsd (`application_answers.py save … --basis …`), aztán futtasd újra a folyamatot; csak ha semmilyen alap nincs, `application_answers.py ask --position-id $PID --key K` (CLOSER prompt, CL-08). Egy általad feltett kérdés tartja a pozíciót, amíg a felhasználó válaszol, kérdésenként legfeljebb egy napig |
| `email_channel` | 4 | a jelentkezési elem egy `mailto:` link, nem űrlap; a checkpoint tartalmazza a `channel: email` értéket és a nyers `mailto_href`-et | ennél a pozíciónál futtasd az `email_application.py send` parancsot az `email-application-flow` skill szerint: ez a checkpointot olvassa; soha ne tölts ki webes űrlapot, és ne írd kézzel az e-mailt |
| `error` | 2 | olvashatatlan profil vagy CV, hibás argumentumok | állj meg: `[BLOCKED]` a Capitanónak |

## `blocked_human` — mit jelent és mit teszel

A folyamat megáll mindennél, amit nem tud biztosan elvégezni:

| `reason` (példák) | Tipikus ok |
|---|---|
| `required_answer_missing` / `required_profile_field_missing` / `required_field_unanswered` | egy kötelező mezőnek nincs mentett válasza; a `pending_question` megnevezi (kulcs, címke, típus, opciók, scope). A felhasználóhoz semmi nem megy, amíg nem futtatod az `ask`-ot; egy mentett válasz a checkpointtól folytatja a folyamatot |
| `essential_facts_missing` / `essential_facts_unavailable` | egy pozíció első futása előtt hiányzik egy adat, amit szinte minden űrlap kér (kezdési dátum, felmondási idő, munkavállalási engedély, sponsorship, bér, költözés, telefon); a `missing` felsorolja a kulcsokat. Semmit nem kérdeztek és semmi sincs visszatartva |
| `captcha` / `two_factor` | az oldal ellenőrizni akarja, hogy ember van-e ott |
| `vacancy_closed` | az állás már nem nyitott: egy űrlap, Apply gomb és e-mail csatorna nélküli oldal ezt írja, vagy az URL az álláslistára, a karrieroldalra vagy a főoldalra irányított át; semmi nem lett kitöltve vagy elküldve. Végleges leállás: új futás nem nyitja meg újra az oldalt, amíg a felhasználó újra nem engedélyezi a pozíciót. Az oldalról képernyőkép készül a checkpoint mellé (`stop_screenshot`) |
| `unknown_required_control` / `answer_type_unknown` / `answer_option_unknown` / `answer_not_accepted` | egy mező, amelyet a recept nem tud mentett válasszal kitölteni |
| `upload_rejected` / `resume_field_missing` / `cv_missing` | a CV nem csatolható |
| `cv_pdf_layout_bad` | a CV PDF nem ment át a vizuális ellenőrzésen (`pdf_layout_check.py`: keskeny oszlopba préselt szöveg, majdnem üres oldal, 2-nél több oldal, nem beágyazott fontok, túl kicsi törzsszöveg): semmit nem csatoltunk és nem küldtünk el. Az Írónak újra kell generálnia; soha ne csatold kézzel. Az 1. oldal előnézete a checkpoint mellett van: nézd meg |
| `cv_pdf_check_unavailable` | a CV PDF-et nem lehetett megmérni (a konténerből hiányzik a poppler, a fájl olvashatatlan): semmit nem csatoltunk és nem küldtünk el — egy nem mért CV nem pass. A megoldás a konténerben van, nem az Írónál: jelezd a Capitano-nak |
| `ats_unsupported` / `ats_conflict` / `ashby_dom_unrecognised` / `greenhouse_dom_unrecognised` / `ashby_form_missing` / `ashby_apply_ambiguous` / `greenhouse_form_missing` / `greenhouse_form_ambiguous` / `lever_dom_unrecognised` / `lever_form_missing` / `lever_apply_ambiguous` / `lever_form_ambiguous` | ehhez az oldalhoz még nincs recept, vagy az űrlap nem az, amelyet a recept ismer |
| `greenhouse_redirect_untrusted` | a folyamat közben a Greenhouse oldal kilépett a három megbízható hostjából |
| `lever_redirect_untrusted` | a folyamat közben a Lever oldal kilépett a `jobs.lever.co` / `jobs.eu.lever.co` hostokból |
| `linkedin_dom_unrecognised` / `linkedin_form_missing` / `linkedin_form_ambiguous` / `linkedin_step_unrecognised` / `linkedin_apply_control_missing` / `linkedin_apply_ambiguous` / `linkedin_session_unavailable` / `linkedin_login_unrecognised` | a LinkedIn-hirdetés vagy az Easy Apply ablaka nem az, amit a recept ismer |
| `linkedin_credentials_missing` | a `$JHT_HOME/credentials/linkedin.json` (`email`, `password`) hiányzik, nem ennek a felhasználónak a 0600-as rendes fájlja, vagy üres: a felhasználó a hitelesítő szkripttel hozza létre. Jelszót chatben soha ne kérj |
| `linkedin_login_failed` | a LinkedIn kétszer elutasította a bejelentkezést: nincs új próbálkozás, amíg a felhasználó új hitelesítő adatokat nem ír |
| `linkedin_login_code_missing` / `linkedin_login_code_undelivered` | a LinkedIn ellenőrző kódját Telegramon kértük, és nem érkezett meg időben (vagy a kérés nem jutott el Telegramra): egy új kör új kódot kér |
| `linkedin_challenge` | a LinkedIn captchát vagy biztonsági ellenőrzést mutat: a felhasználó megoldja az élő képernyőn, majd újra engedélyezi a pozíciót |
| `linkedin_redirect_untrusted` / `application_redirect_untrusted` | a LinkedIn-oldal elhagyta a `www.linkedin.com`-ot, vagy a megadott céges cím nem LinkedInen kívüli HTTPS-oldal (vagy második átadás) |
| `linkedin_follow_not_cleared` | a „cég követése” jelölőnégyzetet nem sikerült Submit előtt kikapcsolni: semmi nem megy el |
| `linkedin_throttled` / `linkedin_login_retry` / `linkedin_interval_invalid` | **elutasítva, nem blokkolva**: a LinkedIn-jelentkezések között szünet van (`linkedin_min_interval_minutes`, alapértelmezés 20), a bejelentkezés egyszer nem sikerült és a következő kör még egyszer próbálja, vagy ez a beállítás nem egész percszám. A sor magától újrapróbálja |
| `mailto_ambiguous` / `mailto_invalid` / `application_form_ambiguous` / `application_field_outside_form` / `submit_outside_form` | két különböző mailto jelentkezési cím, vagy a jelentkezési űrlap, a mezői vagy a küldés gombja nem köthető egyetlen űrlaphoz (hírlevél, lábléc és demó űrlap soha nem része) |
| `form_error` / `field_invalid` / `submit_unavailable` | az űrlap hibát jelez, egy mező formátumát elutasítja, vagy a beküldés gomb hiányzik vagy le van tiltva |
| `url_refused` / `checkpoint_invalid` | a jelentkezési URL nem ment át a nyilvános címek ellenőrzésén, vagy a mentett checkpoint olvashatatlan |
| `page_unavailable` / `browser_uncertainty` | az oldal vagy a böngésző a folyamat közepén hibázott |
| `receipt_missing` / `receipt_incomplete` / `confirmation_ambiguous` | a beküldésre rákattintott, de a megerősítés nem biztos |
| `receipt_screenshot_failed` | a megerősítés látható volt, de a képernyőképét nem sikerült menteni |
| `submit_outcome_unknown` | egy korábbi futás elindította a beküldést és nem hagyott nyugtát |
| `applied_record_failed` | a nyugta létezik, de az állapotot nem sikerült rögzíteni — a jelentkezés szinte biztosan kiment |

Mit teszel minden más oknál (a hiányzó válaszok fent vannak):

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
