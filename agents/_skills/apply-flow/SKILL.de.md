<!-- @translation: de, ai-translated 2026-09-13 -->
---
name: apply-flow
description: Wie der CLOSER eine autorisierte Bewerbung mit `apply_flow.py` ausführt — die Zustandsmaschine mit Checkpoints (detect, fill, upload_cv, screening, review, submit), der Pflichtbeleg, ohne den `applied` nie geschrieben wird, und was bei jedem Ergebnis zu tun ist, allen voran `blocked_human`. Nutze sie für jede aus der Queue genommene Position. Gehört dem CLOSER.
allowed-tools: Bash(python3 /app/shared/skills/apply_flow.py *), Bash(python3 /app/shared/skills/db_query.py *)
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
- Heute ist das einzige vollständige Rezept **Ashby**. Jede andere Plattform blockiert für einen Menschen.

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
| `error` | 2 | Profil oder CV unlesbar, falsche Argumente | stopp: `[BLOCKED]` an den Capitano |

## `blocked_human` — was es bedeutet und was du tust

Der Flow stoppt bei allem, was er nicht mit Sicherheit tun kann:

| `reason` (Beispiele) | Typische Ursache |
|---|---|
| `required_answer_missing` / `required_profile_field_missing` / `required_field_unanswered` | ein Pflichtfeld hat keine gespeicherte Antwort — der User muss sie in `application_answers` ergänzen |
| `captcha` / `two_factor` | die Seite will einen Menschen verifizieren |
| `unknown_required_control` / `answer_type_unknown` / `answer_option_unknown` / `answer_not_accepted` | ein Feld, das das Rezept nicht mit einer gespeicherten Antwort füllen kann |
| `upload_rejected` / `resume_field_missing` / `cv_missing` | der CV lässt sich nicht anhängen |
| `ats_unsupported` / `ats_conflict` / `ashby_dom_unrecognised` | noch kein Rezept für diese Seite |
| `page_unavailable` / `browser_uncertainty` | die Seite oder der Browser ist mitten im Flow ausgefallen |
| `receipt_missing` / `receipt_incomplete` / `confirmation_ambiguous` | Absenden wurde geklickt, aber die Bestätigung ist nicht sicher |
| `submit_outcome_unknown` | ein früherer Lauf hat das Absenden begonnen und keinen Beleg hinterlassen |
| `applied_record_failed` | der Beleg existiert, aber der Zustand konnte nicht aufgezeichnet werden — die Bewerbung ist höchstwahrscheinlich raus |

Was du tust, immer gleich:

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
