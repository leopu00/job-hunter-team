<!-- @translation: de, ai-translated 2026-09-13 -->
---
name: apply-flow
description: Wie der CLOSER eine autorisierte Bewerbung mit `apply_flow.py` ausführt — die Zustandsmaschine mit Checkpoints (detect, fill, upload_cv, screening, review, submit), der Pflichtbeleg, ohne den `applied` nie geschrieben wird, und was bei jedem Ergebnis zu tun ist, allen voran `blocked_human`. Nutze sie für jede aus der Queue genommene Position. Gehört dem CLOSER.
allowed-tools: Bash(python3 /app/shared/skills/apply_flow.py *), Bash(python3 /app/shared/skills/application_answers.py *), Bash(python3 /app/shared/skills/db_query.py *)
---

# apply-flow — eine Bewerbung, ein Beleg, kein blinder Neuversuch

```bash
python3 /app/shared/skills/apply_flow.py \
  --position-id "$PID" \
  --url "$URL" \
  --profile "$JHT_HOME/profile/candidate_profile.yml" \
  --cv "$CV"
```

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
- Heute zwei vollständige Rezepte: **Ashby** und **Greenhouse** (nur seine drei öffentlichen Hosts, `job-boards.greenhouse.io`, `job-boards.eu.greenhouse.io`, `boards.greenhouse.io`, über HTTPS; die Seite wird nach jedem Schritt erneut geprüft). Jede andere Plattform blockiert für einen Menschen.

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
| `blocked_human` | 3 | ein Mensch wird gebraucht; der User wurde schon benachrichtigt | nächste Position; nie neu versuchen |
| `blocked_human` fehlende Antworten (`essential_facts_missing` mit `missing`, `required_answer_missing` mit `pending_question`) | 3 | kein Stopp und nichts wurde gefragt: dem Flow fehlen Antworten | leite jede aus Profil, CV und Stellenanzeige her und speichere sie (`application_answers.py save … --basis …`), dann den Flow erneut starten; nur ohne jede Grundlage `application_answers.py ask --position-id $PID --key K` (CLOSER-Prompt, CL-08). Eine Frage, die du gestellt hast, hält die Position, bis der User antwortet, höchstens einen Tag pro Frage |
| `email_channel` | 4 | das Bewerbungs-Element ist ein `mailto:`-Link, kein Formular; der Checkpoint enthält `channel: email` und den rohen `mailto_href` | führe für diese Position `email_application.py send` aus, wie die Skill `email-application-flow` es sagt: sie liest diesen Checkpoint; fülle nie ein Webformular aus und schreibe die E-Mail nie von Hand |
| `error` | 2 | Profil oder CV unlesbar, falsche Argumente | stopp: `[BLOCKED]` an den Capitano |

## `blocked_human` — was es bedeutet und was du tust

Der Flow stoppt bei allem, was er nicht mit Sicherheit tun kann:

| `reason` (Beispiele) | Typische Ursache |
|---|---|
| `required_answer_missing` / `required_profile_field_missing` / `required_field_unanswered` | ein Pflichtfeld hat keine gespeicherte Antwort; `pending_question` nennt es (Schlüssel, Label, Typ, Optionen, Scope). Der User bekommt nichts, bis du `ask` ausführst; eine gespeicherte Antwort setzt den Flow am Checkpoint fort |
| `essential_facts_missing` / `essential_facts_unavailable` | vor dem ersten Lauf einer Position fehlt eine Angabe, die fast jedes Formular verlangt (Starttermin, Kündigungsfrist, Arbeitserlaubnis, Sponsoring, Gehalt, Umzug, Telefon); `missing` listet die Schlüssel. Nichts wurde gefragt und nichts wird zurückgehalten |
| `captcha` / `two_factor` | die Seite will einen Menschen verifizieren |
| `vacancy_closed` | die Stelle ist nicht mehr offen: eine Seite ohne Formular, Apply-Button und E-Mail-Kanal sagt es, oder die URL leitete auf die Stellenliste, die Karriere- oder Startseite um; nichts wurde ausgefüllt, nichts gesendet. Endgültiger Stopp: ein neuer Lauf öffnet die Seite erst wieder, wenn der Nutzer die Position erneut freigibt. Ein Screenshot der Seite liegt neben dem Checkpoint (`stop_screenshot`) |
| `unknown_required_control` / `answer_type_unknown` / `answer_option_unknown` / `answer_not_accepted` | ein Feld, das das Rezept nicht mit einer gespeicherten Antwort füllen kann |
| `upload_rejected` / `resume_field_missing` / `cv_missing` | der CV lässt sich nicht anhängen |
| `ats_unsupported` / `ats_conflict` / `ashby_dom_unrecognised` / `greenhouse_dom_unrecognised` / `ashby_form_missing` / `ashby_apply_ambiguous` / `greenhouse_form_missing` / `greenhouse_form_ambiguous` | noch kein Rezept für diese Seite, oder das Formular ist nicht das, das das Rezept kennt |
| `greenhouse_redirect_untrusted` | die Greenhouse-Seite hat während des Flows ihre drei vertrauenswürdigen Hosts verlassen |
| `mailto_ambiguous` / `mailto_invalid` / `application_form_ambiguous` / `application_field_outside_form` / `submit_outside_form` | zwei verschiedene mailto-Bewerbungsadressen, oder das Bewerbungsformular, seine Felder oder sein Absende-Button lassen sich nicht einem einzigen Formular zuordnen (Newsletter, Footer und Demo-Formulare gehören nie dazu) |
| `form_error` / `field_invalid` / `submit_unavailable` | das Formular meldet einen Fehler, ein Feldformat wird abgelehnt, oder der Absende-Button fehlt oder ist deaktiviert |
| `url_refused` / `checkpoint_invalid` | die Bewerbungs-URL hat die Prüfung auf öffentliche Adressen nicht bestanden, oder der gespeicherte Checkpoint ist unlesbar |
| `page_unavailable` / `browser_uncertainty` | die Seite oder der Browser ist mitten im Flow ausgefallen |
| `receipt_missing` / `receipt_incomplete` / `confirmation_ambiguous` | Absenden wurde geklickt, aber die Bestätigung ist nicht sicher |
| `receipt_screenshot_failed` | die Bestätigung war sichtbar, aber ihr Screenshot konnte nicht gespeichert werden |
| `submit_outcome_unknown` | ein früherer Lauf hat das Absenden begonnen und keinen Beleg hinterlassen |
| `applied_record_failed` | der Beleg existiert, aber der Zustand konnte nicht aufgezeichnet werden — die Bewerbung ist höchstwahrscheinlich raus |

Was du bei jedem anderen Grund tust (die fehlenden Antworten stehen oben):

1. **Nichts an dieser Position.** Der Flow hat den Checkpoint schon geschrieben
   und den User über `jht-notify-user` benachrichtigt. Benachrichtige ihn nicht erneut.
2. **Nicht neu versuchen.** Nicht jetzt, nicht „noch einmal in ein paar Minuten". Die
   Queue hält sie zurück (`checkpoint_blocked_human`), bis der User sie erneut autorisiert.
3. **Geh zur nächsten Position** der Queue.

Eine blockierte Position neu zu versuchen ist genau der blinde Versuch, den dieses
Design verhindern soll: bei einem Captcha verbrennt er das Konto des Users, bei
einem unbekannten Ergebnis schickt er einen zweiten Brief an denselben Recruiter.

## Eine Bewerbung danach prüfen

```bash
python3 /app/shared/skills/db_query.py application "$PID"
```

`applied_via: agent_closer` und ein nicht leeres `applied_at` = der Flow hat sie aufgezeichnet.
