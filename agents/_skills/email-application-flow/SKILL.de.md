<!-- @translation: de, ai-translated 2026-09-13 -->
---
name: email-application-flow
description: Wie der CLOSER eine autorisierte Bewerbung mit `email_application.py` per E-Mail sendet, wenn `apply_flow.py` `email_channel` antwortet (das Apply-Element ist ein `mailto:`-Link) — inspect, preflight, draft, send, status; das Gate direkt vor dem Transport erneut geprüft; `send_started` vor dem unumkehrbaren Befehl; der Beleg, ohne den `applied` nie geschrieben wird. Nutze sie für jede Position, deren Flow in `email_channel` endet. Gehört dem CLOSER.
allowed-tools: Bash(python3 /app/shared/skills/email_application.py *)
---

# email-application-flow — eine E-Mail, ein Beleg, kein blinder Wiederholungsversuch

Nutze sie **nur** für eine Position der letzten Queue, deren `apply_flow.py`-Lauf
`email_channel` (Exit 4) geantwortet hat. Der Browser-Flow hat den rohen
`mailto_href` in seinem Checkpoint hinterlassen; diese Skill liest ihn. Du öffnest
nie ein Mailprogramm, schreibst nie eine E-Mail von Hand und kopierst die Adresse
nirgendwohin.

```bash
python3 /app/shared/skills/email_application.py send --position-id "$PID" --json
```

`send` führt alles der Reihe nach aus und hält beim ersten Problem an. Die anderen
Befehle dienen zum Lesen, nicht zum Umgehen eines Stopps:

| Befehl | Was er tut |
|---|---|
| `inspect` | liest und zerlegt den mailto-Link (To, CC, Betreff, Text) |
| `preflight` | inspect + Gate + Tageslimit + Transport + CV + Anschreiben + Pflichtangaben |
| `draft` | preflight + der deterministische Entwurf; nichts wird gesendet |
| `send` | draft + erneut das Gate + `send_started` + Transport + Beleg + `applied` |
| `status` | der letzte Versuch und sein Zustand, nur lesend |

`--dry-run` hält vor dem Transport an und ändert nichts an der Bewerbung.

## Was der Befehl garantiert

- **Das Flag ist die Autorisierung.** Das Gate entscheidet im Preflight und erneut
  direkt vor dem Transport. Ein zwischendurch widerrufenes Flag oder ein erreichtes
  Limit bedeutet: nichts wird gesendet (`denied`).
- **Nichts wird erfunden.** Empfänger stammen nur aus dem Link. Name,
  Kontakt-E-Mail und jede Angabe, die die Stelle verlangt (Verfügbarkeit,
  Gehaltsvorstellung), stammen nur aus dem Kandidatenprofil; fehlt eine, ist das
  `required_fact_missing`.
- **Der CV wird immer angehängt**, nach Prüfung von Größe, PDF und Hash. Ein
  Anschreiben wird nur angehängt, wenn die Stelle es verlangt; gibt es keines, wird
  der Scrittore über die normale Schreibanfrage gebeten und der Flow hält an.
- **Höchstens ein Brief.** `send_started` wird festgehalten, bevor der Server die
  Nachricht erhält. Danach ist ein Timeout oder eine unklare Antwort
  `send_outcome_unknown`: nie wiederholt, auch nicht von einem neuen Lauf.
- **`applied` erst nach der Annahme**, mit `applied_via = agent_closer_email`,
  vom Befehl selbst geschrieben, nachdem der Beleg gespeichert ist.

## Das Ergebnis lesen

Eine JSON-Zeile: `state`, `reason`, `detail` plus Daten.

| `state` | Exit | Bedeutung | Was du tust |
|---|---|---|---|
| `sent` | 0 | vom Server angenommen, Beleg gespeichert, Bewerbung registriert | nächste Position |
| `draft_ready` | 0 | Dry Run: Entwurf und Anhänge gültig, nichts gesendet | nächste Position |
| `denied` | 1 | das Gate hat abgelehnt (`flag_revoked`, `gate_mode_changed`, `daily_cap_reached`, `duplicate_attempt`) | nächste Position; nie wiederholen |
| `blocked_human` | 1 | ein Mensch wird gebraucht; der Stopp steht in der Zusammenfassung der Runde | nächste Position; nie wiederholen |
| `send_outcome_unknown` | 3 | die E-Mail ist möglicherweise rausgegangen | nächste Position; nie wiederholen |
| `receipt_incomplete` | 3 | angenommen, aber Beleg oder Registrierung unvollständig; wurden nur einzelne Empfänger abgelehnt, ist der Brief wahrscheinlich angekommen | nächste Position; nie wiederholen |
| `error` | 2 | Datenbank, Profil oder Checkpoint nicht lesbar | Stopp: `[BLOCKED]` an den Capitano |

⚠️ Diese Exit-Codes sind **nicht** die von `apply_flow.py` (dort ist `denied` 1 und
`blocked_human` 3). Entscheide nach `state`, nie nach der Zahl.

## Gründe für `blocked_human`

| `reason` | Typische Ursache |
|---|---|
| `transport_missing` | kein E-Mail-Transport konfiguriert, oder die Geheimnisdatei fehlt oder ist nicht 0600 |
| `auth_failed` | der Mailserver hat die Zugangsdaten abgelehnt |
| `sender_unverified` | die Absenderadresse ist weder das authentifizierte Konto noch ein verifizierter Absender |
| `mailto_missing` | kein Browser-Checkpoint in `email_channel` für diese Position: zuerst `apply_flow.py` ausführen; die Seite wird nie nach einer Adresse durchsucht |
| `recipient_ambiguous` / `mailto_invalid` | null oder mehrere Empfänger, ein verbotener Header, CR/LF in einem Header; auch Local Parts in Anführungszeichen und internationale (IDN) Adressen, die nicht unterstützt werden |
| `recipient_refused` | der Server hat die Empfänger abgelehnt, bevor etwas gesendet wurde: ein neuer Versuch, nachdem der User gehandelt hat, ist kein Duplikat |
| `required_fact_missing` | die Stelle verlangt eine Angabe, die das Profil nicht enthält |
| `cv_missing` | kein lesbarer PDF-CV für diese Bewerbung |
| `cover_letter_required` | die Stelle verlangt ein Anschreiben; der Scrittore wurde gebeten |

Was du tust, immer gleich:

1. **Nichts an dieser Position.** Der Befehl hat den Stopp in die Zusammenfassung der Runde gelegt (`closer_notices.py flush` in STEP 6).
2. **Nicht wiederholen.** Die Queue hält sie zurück (`email_blocked_human`,
   `email_send_outcome_unknown`, ...), bis der User handelt.
3. **Weiter zur nächsten Position** der Queue.

## Niemals

- eine E-Mail auf anderem Weg als mit diesem Befehl senden;
- `send` für eine Position ausführen, die nicht im letzten Queue-Lesen steht;
- nach `send_started`, `send_outcome_unknown` oder `receipt_incomplete` wiederholen;
- `applied`, `applied_via` oder `apply_requested` selbst schreiben;
- das SMTP-Passwort einfügen oder den User im Chat danach fragen.

## Danach prüfen

```bash
python3 /app/shared/skills/email_application.py status --position-id "$PID" --json
```

`state: sent` mit einer `message_id` = der Befehl hat den E-Mail-Versand registriert.
