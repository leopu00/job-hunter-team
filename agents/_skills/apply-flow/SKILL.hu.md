<!-- @translation: hu, ai-translated 2026-09-13 -->
---
name: apply-flow
description: Hogyan futtatja a CLOSER egy engedélyezett jelentkezést az `apply_flow.py`-jal — a checkpointos állapotgép (detect, fill, upload_cv, screening, review, submit), a kötelező nyugta, amely nélkül az `applied` soha nem íródik be, és mit kell tenni az egyes eredményeknél, mindenekelőtt `blocked_human` esetén. Használd minden, a queue-ból felvett pozícióhoz. A CLOSER-é.
allowed-tools: Bash(python3 /app/shared/skills/apply_flow.py *), Bash(python3 /app/shared/skills/application_answers.py *), Bash(python3 /app/shared/skills/db_query.py *), Bash(python3 /app/shared/skills/closer_notices.py *)
---

# apply-flow — egy jelentkezés, egy nyugta, nincs vak újrapróbálás

```bash
python3 /app/shared/skills/apply_flow.py \
  --position-id "$PID" \
  --url "$URL" \
  --profile "$JHT_HOME/profile/candidate_profile.yml" \
  --cv "$CV"
```

Adj ennek a parancsnak legalább **10 perces** időkorlátot: a LinkedIn-bejelentkezés akár 5 percig is várhat a böngészőben az ellenőrző kódra, amelyet a felhasználó Telegramon küld, és a várakozás közben leállított parancs hagyja lejárni a kódkérést.

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
| `retry_later` | 5 | az állás oldala most nem válaszol (5xx, időtúllépés); nem leállás, senki nem kap értesítést; a checkpointban ott a `retry_after` | következő pozíció; a sor a `retry_after` után magától visszaadja — előtte soha ne futtasd újra |
| `blocked_human` | 3 | ember kell; a leállás a kör összefoglalójában van | következő pozíció; soha ne próbáld újra |
| `blocked_human` hiányzó válaszok (`essential_facts_missing` a `missing`-gel, `required_answer_missing` a `pending_question`-nel) | 3 | nem megállás, és semmit nem kérdeztek: a folyamatnak hiányoznak válaszok | mindegyiket következtesd ki a profilból, a CV-ből és a hirdetésből, és mentsd (`application_answers.py save … --basis …`), aztán futtasd újra a folyamatot; csak ha semmilyen alap nincs, `application_answers.py ask --position-id $PID --key K` (CLOSER prompt, CL-08). Egy általad feltett kérdés tartja a pozíciót, amíg a felhasználó válaszol, kérdésenként legfeljebb egy napig |
| `email_channel` | 4 | a jelentkezési elem egy `mailto:` link, nem űrlap; a checkpoint tartalmazza a `channel: email` értéket és a nyers `mailto_href`-et (ok: `mailto_application`); vagy, ha az oldalon nincs jelentkezési űrlap, ok: `email_instruction`: maga az oldal szövege nevezi meg az egyetlen postafiókot („Send your CV to careers@…") | ennél a pozíciónál futtasd az `email_application.py send` parancsot az `email-application-flow` skill szerint: ez a checkpointot olvassa; soha ne tölts ki webes űrlapot, és ne írd kézzel az e-mailt |
| `error` | 2 | olvashatatlan profil vagy CV, hibás argumentumok | állj meg: `[BLOCKED]` a Capitanónak |

## `blocked_human` — mit jelent és mit teszel

A folyamat megáll mindennél, amit nem tud biztosan elvégezni:

| `reason` (példák) | Tipikus ok |
|---|---|
| `required_answer_missing` / `required_profile_field_missing` / `required_field_unanswered` | egy kötelező mezőnek nincs mentett válasza; a `pending_question` megnevezi (kulcs, címke, típus, opciók, scope). A felhasználóhoz semmi nem megy, amíg nem futtatod az `ask`-ot; egy mentett válasz a checkpointtól folytatja a folyamatot A `purpose: contact_form_application` jelzésű `pending_question` egy céges kapcsolatfelvételi űrlap Üzenet mezője, ahová az állás Apply gombja vezetett (a tárgyat a flow a jelentkezési opcióra állítja, CV-mező nincs): írj rövid levelet ehhez az álláshoz, amely jelzi, hogy az önéletrajz kérésre elérhető. |
| `essential_facts_missing` / `essential_facts_unavailable` | egy pozíció első futása előtt hiányzik egy adat, amit szinte minden űrlap kér (kezdési dátum, felmondási idő, munkavállalási engedély, sponsorship, bér, költözés, telefon); a `missing` felsorolja a kulcsokat. Semmit nem kérdeztek és semmi sincs visszatartva |
| `required_answer_missing` `location search` kulccsal | egy helyszínmező csak a saját javaslatai közül fogad el egyet, és a profil locationje nem kereshető hely ("remote", "worldwide"), vagy nem talált semmit a közelében. Mentsd el, hol él a jelölt, `Város, Ország` formában a profilból vagy a CV-ből (`--basis profile` vagy `cv`); a folyamat beírja és kiválasztja az egyező javaslatot, vagy opcióként megadja a közeli javaslatokat. Soha ne a munkavégzési preferenciát, soha ne találomra |
| `captcha` / `two_factor` | az oldal ellenőrizni akarja, hogy ember van-e ott |
| `vacancy_closed` | az állás már nem nyitott: egy űrlap, Apply gomb és e-mail csatorna nélküli oldal ezt írja, vagy az URL az álláslistára, a karrieroldalra vagy a főoldalra irányított át; semmi nem lett kitöltve vagy elküldve. Végleges leállás: új futás nem nyitja meg újra az oldalt, amíg a felhasználó újra nem engedélyezi a pozíciót. Az oldalról képernyőkép készül a checkpoint mellé (`stop_screenshot`) |
| `unknown_required_control` / `answer_type_unknown` / `answer_option_unknown` / `answer_not_accepted` | egy mező, amelyet a recept nem tud mentett válasszal kitölteni |
| `upload_rejected` / `resume_field_missing` / `cv_missing` | a CV nem csatolható |
| `upload_widget_unavailable` | a Greenhouse feltöltő modulja nem indult el (szkripthiba a Resume/CV alatt, két próbálkozás): a fájlt nem utasították el; egy későbbi kör újrapróbálja |
| `greenhouse_verification_failed` | a Greenhouse Submit után ellenőrző kódot küldött, és nem lehetett felhasználni (nem jött időben email vagy Telegram-válasz, vagy elutasította a kódot): a jelentkezés nem ment el, és magától soha nem küldi újra |
| `greenhouse_verification_lost` | egy már elindított beküldés kódképernyője eltűnt (új böngésző, elveszett munkamenet): egy futásban soha nincs két beküldés; a felhasználó új jóváhagyása után csak az a beküldés indul újra egyszer, új böngészőben, amely a kódképernyőt látáskor rögzítette és kódot nem írt be |
| `cv_pdf_layout_bad` | a CV PDF nem ment át a vizuális ellenőrzésen (`pdf_layout_check.py`: keskeny oszlopba préselt szöveg, majdnem üres oldal, 2-nél több oldal, nem beágyazott fontok, túl kicsi törzsszöveg): semmit nem csatoltunk és nem küldtünk el. Az Írónak újra kell generálnia; soha ne csatold kézzel. Az 1. oldal előnézete a checkpoint mellett van: nézd meg |
| `cv_pdf_check_unavailable` | a CV PDF-et nem lehetett megmérni (a konténerből hiányzik a poppler, a fájl olvashatatlan): semmit nem csatoltunk és nem küldtünk el — egy nem mért CV nem pass. A megoldás a konténerben van, nem az Írónál: jelezd a Capitano-nak |
| `ats_unsupported` / `ats_conflict` / `ashby_dom_unrecognised` / `greenhouse_dom_unrecognised` / `ashby_form_missing` / `ashby_apply_ambiguous` / `greenhouse_form_missing` / `greenhouse_form_ambiguous` / `lever_dom_unrecognised` / `lever_form_missing` / `lever_apply_ambiguous` / `lever_form_ambiguous` / `generic_dom_unrecognised` | ehhez az oldalhoz még nincs recept, vagy az űrlap nem az, amelyet a recept ismer |
| `greenhouse_redirect_untrusted` | a folyamat közben a Greenhouse oldal kilépett a három megbízható hostjából |
| `lever_redirect_untrusted` | a folyamat közben a Lever oldal kilépett a `jobs.lever.co` / `jobs.eu.lever.co` hostokból |
| `linkedin_dom_unrecognised` / `linkedin_form_missing` / `linkedin_form_ambiguous` / `linkedin_step_unrecognised` / `linkedin_apply_control_missing` / `linkedin_apply_ambiguous` / `linkedin_session_unavailable` / `linkedin_login_unrecognised` | a LinkedIn-hirdetés vagy az Easy Apply ablaka nem az, amit a recept ismer |
| `linkedin_credentials_missing` | a `$JHT_HOME/credentials/linkedin.json` (`email`, `password`) hiányzik, nem ennek a felhasználónak a 0600-as rendes fájlja, vagy üres: a felhasználó a hitelesítő szkripttel hozza létre. Jelszót chatben soha ne kérj |
| `linkedin_session_expired` | a felhasználó által kézzel létrehozott LinkedIn-munkamenet (`linkedin_apply.py login --interactive`, pl. Google-lel) lejárt, vagy a LinkedIn már nem fogadja el: a felhasználó újra kézzel bejelentkezik, majd újra engedélyezi a pozíciót. Soha ne próbálj te Google-bejelentkezést |
| `linkedin_login_failed` | a LinkedIn kétszer elutasította a bejelentkezést: nincs új próbálkozás, amíg a felhasználó új hitelesítő adatokat nem ír |
| `linkedin_login_code_missing` / `linkedin_login_code_undelivered` | a LinkedIn ellenőrző kódját Telegramon kértük, és nem érkezett meg időben (vagy a kérés nem jutott el Telegramra, vagy a LinkedIn nem fogadta el a kódot — ez sosem számít sikertelen bejelentkezésnek): egy új kör új kódot kér |
| `linkedin_challenge` | a LinkedIn captchát vagy biztonsági ellenőrzést mutat: a felhasználó megoldja az élő képernyőn, majd újra engedélyezi a pozíciót |
| `linkedin_redirect_untrusted` / `application_redirect_untrusted` | a LinkedIn-oldal elhagyta a LinkedInt (`www.linkedin.com` vagy egy országoldal, pl. `es.linkedin.com`), vagy a megadott céges cím nem LinkedInen kívüli HTTPS-oldal (vagy második átadás) |
| `linkedin_follow_not_cleared` | a „cég követése” jelölőnégyzetet nem sikerült Submit előtt kikapcsolni: semmi nem megy el |
| `linkedin_throttled` / `linkedin_login_retry` / `linkedin_interval_invalid` / `linkedin_dry_run_signed_out` / `linkedin_profile_busy` | **elutasítva, nem blokkolva**: a LinkedIn-jelentkezések között szünet van (`linkedin_min_interval_minutes`, alapértelmezés 20), a bejelentkezés egyszer nem sikerült és a következő kör még egyszer próbálja, vagy ez a beállítás nem egész percszám. A sor magától újrapróbálja Egy próbafuttatás sosem jelentkezik be: mentett LinkedIn-munkamenet nélkül `linkedin_dry_run_signed_out` elutasítást kap. Egy másik böngésző használja a kézzel létrehozott LinkedIn-profilt (`linkedin_profile_busy`): kézi bejelentkezés van folyamatban. |
| `mailto_ambiguous` / `mailto_invalid` / `application_form_ambiguous` / `application_field_outside_form` / `submit_outside_form` | két különböző mailto jelentkezési cím, vagy a jelentkezési űrlap, a mezői vagy a küldés gombja nem köthető egyetlen űrlaphoz (hírlevél, lábléc és demó űrlap soha nem része) |
| `form_error` / `field_invalid` / `submit_unavailable` | az űrlap hibát jelez, egy mező formátumát elutasítja, vagy a beküldés gomb hiányzik vagy le van tiltva |
| `url_refused` / `checkpoint_invalid` | a jelentkezési URL nem ment át a nyilvános címek ellenőrzésén, vagy a mentett checkpoint olvashatatlan |
| `page_unavailable` / `browser_uncertainty` | az oldal vagy a böngésző a folyamat közepén hibázott |
| `page_not_found` / `bot_protection` / `page_temporarily_unavailable` | az állás oldala már nincs meg (404/410 lezárt állásra utaló bizonyíték nélkül), bot elleni ellenőrzés állította meg a böngészőt (egy látható böngészős próbálkozás után), vagy az oldal egy nap alatt háromszor nem válaszolt. Egyetlen 5xx vagy időtúllépés NEM leállás: a checkpoint `retry_later`, a sor később magától visszaadja a pozíciót, és senki nem kap értesítést. A checkpoint megőrzi a `http_status` és `final_url` értéket |
| `receipt_missing` / `receipt_incomplete` / `confirmation_ambiguous` | a beküldésre rákattintott, de a megerősítés nem biztos |
| `receipt_screenshot_failed` | a megerősítés látható volt, de a képernyőképét nem sikerült menteni |
| `submit_outcome_unknown` | egy korábbi futás elindította a beküldést és nem hagyott nyugtát |
| `applied_record_failed` | a nyugta létezik, de az állapotot nem sikerült rögzíteni — a jelentkezés szinte biztosan kiment |
| `login_required` / `account_creation` | az oldal bejelentkezést vagy új fiókot kér a jelentkezés előtt: a CLOSER soha nem jelentkezik be és soha nem hoz létre fiókot |
| `generic_form_missing` / `generic_form_unrecognised` / `application_form_embedded` / `application_redirect_untrusted` | céges oldal: nincs jelentkezési űrlap, olyan űrlap van, amelyet az általános recept nem tud egyértelműen azonosítani, más hostról beágyazott űrlap (a detail megnevezi), vagy a Jelentkezés gomb recept nélküli oldalra visz |
| `cover_letter_required` / `pre_submit_screenshot_failed` | az űrlap motivációs levél fájlt kér · a kitöltött űrlapról nem sikerült képet készíteni a kattintás előtt |

Mit teszel minden más oknál (a hiányzó válaszok fent vannak):

1. **Semmit azzal a pozícióval.** A folyamat már megírta a checkpointot és
   betette a leállást a kör összefoglalójába. Ne te értesítsd a felhasználót.
2. **Ne próbáld újra.** Se most, se „még egyszer pár perc múlva". A queue
   visszatartja (`checkpoint_blocked_human`), amíg a felhasználó újra nem engedélyezi.
3. **Lépj a queue következő pozíciójára.**

Egy blokkolt pozíció újrapróbálása éppen az a vak próbálkozás, amelynek
megakadályozására ez a design létezik: captchánál leégeti a felhasználó fiókját,
ismeretlen eredménynél második levelet küld ugyanannak a recruiternek.

## Céges karrieroldalak — az általános recept

Ha egyetlen ATS sem ismerhető fel, és az oldal nem `mailto:` csatorna, a folyamat
az `apply_generic.py`-t használja a cég saját oldalán: megkeresi az EGYETLEN
jelentkezési űrlapot (CV-feltöltés, vagy név és e-mail egy Jelentkezés gombbal —
akár egy Jelentkezés gomb mögött vagy ugyanazon oldal egy linkelt lapján),
a mezőket a címkéjük alapján tölti ki (a profilból a nevet, e-mailt, telefont,
linkeket; a kérdésekhez a mentett válaszokat), és soha nem nyúl hírlevél-,
kapcsolat-, kereső- vagy bejelentkezési űrlaphoz. A kitöltött űrlapról a
kattintás előtt kép készül; felismerhető visszaigazolás (szöveg vagy URL) nélkül
az eredmény `submit_outcome_unknown`, soha nincs második kattintás. Egy ismert
ATS-re vezető Jelentkezés gomb az adott receptnek adja át a pozíciót.

**Körönként egy összefoglaló.** Egyetlen leállásról sem megy külön értesítés: minden
`blocked_human`, ami nem űrlapkérdés (oldalak, pl. `ats_unsupported`, `ats_conflict`, `linkedin_easy_apply`, `application_form_embedded`, `page_not_found`, `bot_protection`, `page_temporarily_unavailable`; LinkedIn, önéletrajz, lezárt állások, bizonytalan
kimenetek, az e-mail-csatorna leállásai), arra az EGY üzenetre vár, amit a STEP 6-ban küldesz a
`python3 /app/shared/skills/closer_notices.py flush` paranccsal. Azonnal csak egy kifejezetten
feltett kérdés, az alapvető adatok és egy LinkedIn ellenőrző kód megy ki.
Minden értesítés a felhasználó profiljának nyelvén érkezik.

## Egy jelentkezés utólagos ellenőrzése

```bash
python3 /app/shared/skills/db_query.py application "$PID"
```

`applied_via: agent_closer` és egy nem üres `applied_at` = a folyamat rögzítette.
