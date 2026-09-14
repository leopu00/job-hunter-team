<!-- @translation: de, ai-translated 2026-09-13 -->
---
name: apply-flow
description: Wie der CLOSER eine autorisierte Bewerbung mit `apply_flow.py` ausführt — die Zustandsmaschine mit Checkpoints (detect, fill, upload_cv, screening, review, submit), der Pflichtbeleg, ohne den `applied` nie geschrieben wird, und was bei jedem Ergebnis zu tun ist, allen voran `blocked_human`. Nutze sie für jede aus der Queue genommene Position. Gehört dem CLOSER.
allowed-tools: Bash(python3 /app/shared/skills/apply_flow.py *), Bash(python3 /app/shared/skills/application_answers.py *), Bash(python3 /app/shared/skills/db_query.py *), Bash(python3 /app/shared/skills/closer_notices.py *)
---

# apply-flow — eine Bewerbung, ein Beleg, kein blinder Neuversuch

```bash
python3 /app/shared/skills/apply_flow.py \
  --position-id "$PID" \
  --url "$URL" \
  --profile "$JHT_HOME/profile/candidate_profile.yml" \
  --cv "$CV"
```

Gib diesem Befehl ein Timeout von mindestens **10 Minuten**: eine LinkedIn-Anmeldung kann im Browser bis zu 5 Minuten auf den Bestätigungscode warten, den die Person auf Telegram schickt, und ein Befehl, der währenddessen beendet wird, lässt die Code-Anfrage verfallen.

`PID`, `URL` und `CV` kommen aus dem letzten Lesen von `apply_gate.py queue`
(Skill `apply-authorization`), nie aus dem Gedächtnis.

## Die Zustandsmaschine

```
detect → fill → upload_cv → screening → review → submit → applied
                                                        ↘ blocked_human
```

- Jeder abgeschlossene Schritt wird in einem Checkpoint gespeichert (`$JHT_HOME/.cache/apply-flow/<id>.json`).
  Nach einem Absturz macht der Flow dort weiter: das Ausfüllen wird wiederholt, der Klick nicht.
- `submit_started` wird **vor** dem Klick gespeichert. Stirbt ein Prozess nach dieser
  Zeile, ist das Ergebnis unbekannt, und ein unbekanntes Ergebnis wird nie erneut
  geklickt: der Flow sucht auf der Seite eine Bestätigung und blockiert ohne sie mit
  `submit_outcome_unknown`.
- Das Tor wird beim Start **und** direkt vor dem Klick geprüft. Ein Flag, das
  während des Ausfüllens widerrufen wurde, stoppt das Absenden.
- Heute drei vollständige Rezepte: **Ashby**, **Greenhouse** (nur seine drei öffentlichen Hosts, `job-boards.greenhouse.io`, `job-boards.eu.greenhouse.io`, `boards.greenhouse.io`, über HTTPS; die Seite wird nach jedem Schritt erneut geprüft) und **Lever** (nur `jobs.lever.co` und `jobs.eu.lever.co`, über HTTPS, genauso erneut geprüft). LinkedIn: „auf der Firmenwebsite bewerben“ geht auf dieser Website mit ihrem Rezept weiter; Easy Apply meldet sich mit dem Konto des Benutzers an (Sitzung bleibt, Bestätigungscode über Telegram) und füllt den Dialog aus. Jede andere Plattform blockiert für einen Menschen.

## Der Beleg

`applied` wird nur geschrieben, wenn der Flow **beides** hat:

1. einen Screenshot der Bestätigungsseite, und
2. eine Bestätigungs-URL oder einen Bestätigungstext.

Dann zeichnet der Flow selbst die Bewerbung mit `applied_via = agent_closer` auf
und liest die Zeile zurück, um zu prüfen, dass der Schreibvorgang passiert ist.
Niemand sonst schreibt diesen Zustand: nicht du, nicht der Capitano.

## Das Ergebnis lesen

Eine JSON-Zeile auf stdout: `status`, `state`, `reason`, `receipt`.

| `status` | Exit | Bedeutung | Was du tust |
|---|---|---|---|
| `applied` | 0 | gesendet, Beleg gespeichert, Zustand aufgezeichnet | nächste Position |
| `dry_run` | 0 | `mode: dry_run`: ausgefüllt, vor dem Button gestoppt, nichts gesendet | nächste Position |
| `denied` | 1 | das Tor hat abgelehnt (Zustimmung aus, Flag widerrufen, schon gesendet) | nächste Position; nie neu versuchen |
| `retry_later` | 5 | die Seite der Stelle antwortet gerade nicht (5xx, Zeitüberschreitung); kein Stopp, niemand wird benachrichtigt; der Checkpoint hat `retry_after` | nächste Position; die Warteschlange gibt sie nach `retry_after` von selbst zurück — nie vorher neu starten |
| `blocked_human` | 3 | ein Mensch wird gebraucht; der Stopp steht in der Zusammenfassung der Runde | nächste Position; nie neu versuchen |
| `blocked_human` fehlende Antworten (`essential_facts_missing` mit `missing`, `required_answer_missing` mit `pending_question`) | 3 | kein Stopp und nichts wurde gefragt: dem Flow fehlen Antworten | leite jede aus Profil, CV und Stellenanzeige her und speichere sie (`application_answers.py save … --basis …`), dann den Flow erneut starten; nur ohne jede Grundlage `application_answers.py ask --position-id $PID --key K` (CLOSER-Prompt, CL-08). Eine Frage, die du gestellt hast, hält die Position, bis der User antwortet, höchstens einen Tag pro Frage |
| `email_channel` | 4 | das Bewerbungs-Element ist ein `mailto:`-Link, kein Formular; der Checkpoint enthält `channel: email` und den rohen `mailto_href` (Grund `mailto_application`); oder, ohne Bewerbungsformular auf der Seite, Grund `email_instruction`: der Text der Seite selbst nennt das eine Postfach („Send your CV to careers@…") | führe für diese Position `email_application.py send` aus, wie die Skill `email-application-flow` es sagt: sie liest diesen Checkpoint; fülle nie ein Webformular aus und schreibe die E-Mail nie von Hand |
| `error` | 2 | Profil oder CV unlesbar, falsche Argumente | stopp: `[BLOCKED]` an den Capitano |

## `blocked_human` — was es bedeutet und was du tust

Der Flow stoppt bei allem, was er nicht mit Sicherheit tun kann:

| `reason` (Beispiele) | Typische Ursache |
|---|---|
| `required_answer_missing` / `required_profile_field_missing` / `required_field_unanswered` | ein Pflichtfeld hat keine gespeicherte Antwort; `pending_question` nennt es (Schlüssel, Label, Typ, Optionen, Scope). Der User bekommt nichts, bis du `ask` ausführst; eine gespeicherte Antwort setzt den Flow am Checkpoint fort Eine `pending_question` mit `purpose: contact_form_application` ist die Nachricht eines Kontaktformulars des Unternehmens, zu dem der Apply-Button der Stelle geführt hat (das Thema setzt der Flow auf die Bewerbungsoption, kein CV-Feld): schreibe einen kurzen Brief zu dieser Stelle, der sagt, dass der Lebenslauf auf Anfrage verfügbar ist. |
| `essential_facts_missing` / `essential_facts_unavailable` | vor dem ersten Lauf einer Position fehlt eine Angabe, die fast jedes Formular verlangt (Starttermin, Kündigungsfrist, Arbeitserlaubnis, Sponsoring, Gehalt, Umzug, Telefon); `missing` listet die Schlüssel. Nichts wurde gefragt und nichts wird zurückgehalten |
| `required_answer_missing` mit Schlüssel `location search` | ein Ortsfeld nimmt nur einen seiner eigenen Vorschläge, und die Location im Profil ist kein nachschlagbarer Ort ("remote", "weltweit") oder hat nichts in der Nähe gefunden. Speichere den Wohnort des Kandidaten als `Stadt, Land` aus Profil oder CV (`--basis profile` oder `cv`); der Flow tippt ihn ein und wählt den passenden Vorschlag oder gibt dir die nahen Vorschläge als Optionen. Nie die Arbeitspräferenz, nie geraten |
| `captcha` / `two_factor` | die Seite will einen Menschen verifizieren |
| `vacancy_closed` | die Stelle ist nicht mehr offen: eine Seite ohne Formular, Apply-Button und E-Mail-Kanal sagt es, oder die URL leitete auf die Stellenliste, die Karriere- oder Startseite um; nichts wurde ausgefüllt, nichts gesendet. Endgültiger Stopp: ein neuer Lauf öffnet die Seite erst wieder, wenn der Nutzer die Position erneut freigibt. Ein Screenshot der Seite liegt neben dem Checkpoint (`stop_screenshot`) |
| `unknown_required_control` / `answer_type_unknown` / `answer_option_unknown` / `answer_not_accepted` | ein Feld, das das Rezept nicht mit einer gespeicherten Antwort füllen kann |
| `upload_rejected` / `resume_field_missing` / `cv_missing` | der CV lässt sich nicht anhängen |
| `cv_pdf_layout_bad` | das CV-PDF hat die visuelle Prüfung nicht bestanden (`pdf_layout_check.py`: Text in eine schmale Spalte gedrückt, eine fast leere Seite, mehr als 2 Seiten, Schriften nicht eingebettet, Fließtext zu klein): nichts wurde angehängt oder gesendet. Der Writer muss es neu rendern; nie von Hand anhängen. Die Vorschau von Seite 1 liegt neben dem Checkpoint: sieh sie dir an |
| `cv_pdf_check_unavailable` | das CV-PDF konnte nicht gemessen werden (poppler fehlt im Container, Datei unlesbar): nichts wurde angehängt oder gesendet — ein ungemessener CV ist kein Pass. Die Abhilfe liegt im Container, nicht beim Writer: melde es dem Capitano |
| `ats_unsupported` / `ats_conflict` / `ashby_dom_unrecognised` / `greenhouse_dom_unrecognised` / `ashby_form_missing` / `ashby_apply_ambiguous` / `greenhouse_form_missing` / `greenhouse_form_ambiguous` / `lever_dom_unrecognised` / `lever_form_missing` / `lever_apply_ambiguous` / `lever_form_ambiguous` / `generic_dom_unrecognised` | noch kein Rezept für diese Seite, oder das Formular ist nicht das, das das Rezept kennt |
| `greenhouse_redirect_untrusted` | die Greenhouse-Seite hat während des Flows ihre drei vertrauenswürdigen Hosts verlassen |
| `lever_redirect_untrusted` | die Lever-Seite hat während des Flows `jobs.lever.co` / `jobs.eu.lever.co` verlassen |
| `linkedin_dom_unrecognised` / `linkedin_form_missing` / `linkedin_form_ambiguous` / `linkedin_step_unrecognised` / `linkedin_apply_control_missing` / `linkedin_apply_ambiguous` / `linkedin_session_unavailable` / `linkedin_login_unrecognised` | die LinkedIn-Stelle oder ihr Easy-Apply-Dialog ist nicht der, den das Rezept kennt |
| `linkedin_credentials_missing` | `$JHT_HOME/credentials/linkedin.json` (`email`, `password`) fehlt, ist keine reguläre 0600-Datei dieses Benutzers oder ist leer: der Benutzer legt sie mit dem Zugangsdaten-Skript an. Nie im Chat nach dem Passwort fragen |
| `linkedin_login_failed` | LinkedIn hat die Anmeldung zweimal abgelehnt: kein neuer Versuch, bis der Benutzer neue Zugangsdaten schreibt |
| `linkedin_login_code_missing` / `linkedin_login_code_undelivered` | der LinkedIn-Bestätigungscode wurde auf Telegram angefragt und kam nicht rechtzeitig (oder die Anfrage erreichte Telegram nicht, oder LinkedIn nahm den Code nicht an — das zählt nie als fehlgeschlagene Anmeldung): ein neuer Lauf fragt nach einem neuen Code |
| `linkedin_challenge` | LinkedIn zeigt ein Captcha oder eine Sicherheitsprüfung: der Benutzer löst sie auf dem Live-Bildschirm und autorisiert die Stelle erneut |
| `linkedin_redirect_untrusted` / `application_redirect_untrusted` | die LinkedIn-Seite hat LinkedIn (`www.linkedin.com` oder eine Länderseite wie `es.linkedin.com`) verlassen, oder die angegebene Firmenadresse ist keine HTTPS-Seite außerhalb von LinkedIn (oder eine zweite Übergabe) |
| `linkedin_follow_not_cleared` | das Kästchen „Unternehmen folgen“ ließ sich vor Submit nicht abwählen: nichts wird gesendet |
| `linkedin_throttled` / `linkedin_login_retry` / `linkedin_interval_invalid` / `linkedin_dry_run_signed_out` | **abgelehnt, nicht blockiert**: LinkedIn-Bewerbungen werden zeitlich verteilt (`linkedin_min_interval_minutes`, Standard 20), die Anmeldung schlug einmal fehl und der nächste Lauf versucht es noch einmal, oder diese Einstellung ist keine ganze Minutenzahl. Die Warteschlange versucht es selbst erneut Ein Probelauf meldet sich nie an: ohne gespeicherte LinkedIn-Sitzung wird er als `linkedin_dry_run_signed_out` abgelehnt. |
| `mailto_ambiguous` / `mailto_invalid` / `application_form_ambiguous` / `application_field_outside_form` / `submit_outside_form` | zwei verschiedene mailto-Bewerbungsadressen, oder das Bewerbungsformular, seine Felder oder sein Absende-Button lassen sich nicht einem einzigen Formular zuordnen (Newsletter, Footer und Demo-Formulare gehören nie dazu) |
| `form_error` / `field_invalid` / `submit_unavailable` | das Formular meldet einen Fehler, ein Feldformat wird abgelehnt, oder der Absende-Button fehlt oder ist deaktiviert |
| `url_refused` / `checkpoint_invalid` | die Bewerbungs-URL hat die Prüfung auf öffentliche Adressen nicht bestanden, oder der gespeicherte Checkpoint ist unlesbar |
| `page_unavailable` / `browser_uncertainty` | die Seite oder der Browser ist mitten im Flow ausgefallen |
| `page_not_found` / `bot_protection` / `page_temporarily_unavailable` | die Seite der Stelle ist weg (404/410 ohne Beleg für eine geschlossene Stelle), eine Anti-Bot-Prüfung hat den Browser gestoppt (nach einem Versuch in einem sichtbaren Browser), oder die Website hat an einem Tag dreimal nicht geantwortet. Ein einzelner 5xx oder Timeout ist KEIN Stopp: der Checkpoint sagt `retry_later`, die Warteschlange gibt die Stelle später von selbst zurück, und niemand wird benachrichtigt. Der Checkpoint behält `http_status` und `final_url` |
| `receipt_missing` / `receipt_incomplete` / `confirmation_ambiguous` | Absenden wurde geklickt, aber die Bestätigung ist nicht sicher |
| `receipt_screenshot_failed` | die Bestätigung war sichtbar, aber ihr Screenshot konnte nicht gespeichert werden |
| `submit_outcome_unknown` | ein früherer Lauf hat das Absenden begonnen und keinen Beleg hinterlassen |
| `applied_record_failed` | der Beleg existiert, aber der Zustand konnte nicht aufgezeichnet werden — die Bewerbung ist höchstwahrscheinlich raus |
| `login_required` / `account_creation` | die Seite verlangt vor der Bewerbung eine Anmeldung oder ein neues Konto: der CLOSER meldet sich nie an und legt nie Konten an |
| `generic_form_missing` / `generic_form_unrecognised` / `application_form_embedded` / `application_redirect_untrusted` | eine Unternehmensseite: kein Bewerbungsformular, ein Formular, das das generische Rezept nicht eindeutig findet, ein von einem anderen Host eingebettetes Formular (das detail nennt ihn) oder ein Bewerben-Button, der zu einer Seite ohne Rezept führt |
| `cover_letter_required` / `pre_submit_screenshot_failed` | das Formular verlangt eine Anschreiben-Datei · das ausgefüllte Formular konnte vor dem Klick nicht fotografiert werden |

Was du bei jedem anderen Grund tust (die fehlenden Antworten stehen oben):

1. **Nichts an dieser Position.** Der Flow hat den Checkpoint schon geschrieben
   und den Stopp in die Zusammenfassung der Runde gelegt. Benachrichtige den User nicht selbst.
2. **Nicht neu versuchen.** Nicht jetzt, nicht „noch einmal in ein paar Minuten". Die
   Queue hält sie zurück (`checkpoint_blocked_human`), bis der User sie erneut autorisiert.
3. **Geh zur nächsten Position** der Queue.

Eine blockierte Position neu zu versuchen ist genau der blinde Versuch, den dieses
Design verhindern soll: bei einem Captcha verbrennt er das Konto des Users, bei
einem unbekannten Ergebnis schickt er einen zweiten Brief an denselben Recruiter.

## Karriereseiten von Unternehmen — das generische Rezept

Wenn kein ATS erkannt wird und die Seite kein `mailto:`-Kanal ist, nutzt der
Ablauf `apply_generic.py` auf der Seite des Unternehmens: Es findet das EINE
Bewerbungsformular (ein Lebenslauf-Upload, oder Name und E-Mail mit einem
Bewerben-Button — auch hinter einem Bewerben-Button oder auf einer verlinkten
Seite derselben Website), füllt die Felder anhand ihrer Beschriftungen (Profil
für Name, E-Mail, Telefon, Links; gespeicherte Antworten für die Fragen) und
berührt nie ein Newsletter-, Kontakt-, Such- oder Anmeldeformular. Das
ausgefüllte Formular wird vor dem Klick fotografiert; ohne erkennbare Bestätigung
(Text oder URL) ist das Ergebnis `submit_outcome_unknown`, nie ein zweiter Klick.
Ein Bewerben-Button, der zu einem bekannten ATS führt, übergibt die Stelle an
dieses Rezept.

**Eine Zusammenfassung pro Runde.** Kein Stopp wird einzeln gemeldet: jeder `blocked_human`,
der keine Formularfrage ist (Seiten wie `ats_unsupported`, `ats_conflict`, `linkedin_easy_apply`, `application_form_embedded`, `page_not_found`, `bot_protection`, `page_temporarily_unavailable`; LinkedIn, Lebenslauf, geschlossene Stellen, unklare
Ergebnisse, Stopps des E-Mail-Kanals), wartet auf die EINE Nachricht, die du in STEP 6 mit
`python3 /app/shared/skills/closer_notices.py flush` sendest. Sofort gesendet werden nur eine
Frage, die du ausdrücklich stellst, die wesentlichen Angaben und ein LinkedIn-Bestätigungscode.
Jede Meldung erreicht den User in der Sprache seines Profils.

## Eine Bewerbung danach prüfen

```bash
python3 /app/shared/skills/db_query.py application "$PID"
```

`applied_via: agent_closer` und ein nicht leeres `applied_at` = der Flow hat sie aufgezeichnet.
