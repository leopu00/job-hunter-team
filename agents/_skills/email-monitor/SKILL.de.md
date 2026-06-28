<!-- @translation: de, ai-translated 2026-06-20 -->
---
name: email-monitor
description: "Day-start Sourcing aus dem DEDIZIERTEN E-Mail-Postfach des Teams (der Benutzer leitet euch seine eigenen Job-Alerts weiter). Quelle mit hoechster Genauigkeit: der Alert ist bereits auf die Absicht des Benutzers vorgefiltert. IMAP-Polling JEDER Plattform (LinkedIn/Glassdoor/Indeed + nationale/staedtische/Nischen-Boards), erstellt Positionen mit dem source-Tag, idempotent pro Message-ID. Das VOLUMEN steuert der Capitano (C-16): zu Tagesbeginn liest man die E-Mail VOR dem Web-Scraping; bei Flood werden nur die markanten aufgenommen, damit der Funnel zum SCORE gelangt."
allowed-tools: Bash(python3 /app/shared/skills/email_monitor.py *), Bash(python3 /app/shared/skills/scout_dedup.py *), Bash(python3 /app/shared/skills/db_insert.py *), Bash(python3 /app/shared/skills/db_query.py *)
---

# email-monitor — die weitergeleiteten Job-Alerts lesen, zu Tagesbeginn

Der Benutzer erstellt eine **dedizierte** E-Mail (z.B. `name.jht@gmail.com`) und
richtet in seinem eigenen Client **Weiterleitungsregeln** ein, die uns die
Job-Alerts schicken (LinkedIn, Glassdoor, Indeed **und jede andere Plattform**,
die per Mail benachrichtigt). Du liest dieses Postfach und verwandelst die Alerts
in Positionen. Es ist die **genaueste** Quelle (der Alert ist vom Benutzer bereits
auf das Ziel gefiltert) und die **token-guenstigste** (kein blindes Scraping).

> 📍 **Optional, aber empfohlen.** Wenn sie nicht konfiguriert ist, arbeitet das
> Team wie zuvor (Web-Sourcing). Keine Blockade.

## Wann

- **Zu Beginn des Arbeitsfensters** (day-start): lies die E-Mail **VOR** dem
  Web-Scraping. Die naechtlichen Alerts sind bereits da.
- Danach maximal alle ~30 Min (das serverseitige IMAP rate-limitet darueber
  hinaus, und neue Alerts kommen nicht haeufiger an). Nicht haeufiger pollen.
- Claim der Quelle in STEP 0 (`scout-coord`): `scout_workspace.py claim
  <agent> email:<box>` — nur ein Scout pro Postfach, keine Kollisionen.

## Vorgehen

### 1. Ist sie konfiguriert?
```bash
python3 /app/shared/skills/email_monitor.py status
```
`configured=false` → das Postfach ist nicht da: ueberspringen, normales
Web-Sourcing machen.
`any_platform=true` bedeutet, dass wir die **gesamte** dedizierte Inbox
verarbeiten (kein eingeschraenkter `from_filters`) → jeder Absender, den der
Benutzer weiterleitet, wird gelesen.

### 2. Schaetze das VOLUMEN (guenstig, kein Body-Fetch)
```bash
python3 /app/shared/skills/email_monitor.py count
```
Liefert `new_total` + `by_sender`. Dient **dir und dem Capitano**, um zu erkennen,
ob es ein handhabbares Volumen oder ein **Flood** ist. Bei Flood **sagt dir der
Capitano (C-16), wie viele / welche** aufzunehmen sind: das Ziel ist, dass die
Positionen einen **Score** erreichen, nicht 200 davon nie bewertet anzuhaeufen.

### 3. Poll → Leads
```bash
python3 /app/shared/skills/email_monitor.py poll --since-days 1
```
Jede JSONL-Zeile ist ein Lead: `{"url","source","subject","sender","received_at"}`.
- `source` = `linkedin-email` / `glassdoor-email` / `indeed-email` fuer die
  bekannten Provider, `email:<domain>` fuer jede andere Plattform (generische
  Extraktion).
- Die Idempotenz (Message-ID in `state/email_monitor_seen.json`) garantiert, dass
  ein Re-run die gleichen Alerts **nicht** erneut verarbeitet.

### 4. Fuer jeden Lead → die 5 Gates von `position-insert`
Behandle jede `url` **genau wie einen Web-Hit**: Dedup (`scout_dedup.py`) →
Pruefung des aktiven Links → Fetch JD → 4 Scout-Filter → INSERT in `positions`
(`status=new`). **Behalte das `--source`-Tag** des Leads (`linkedin-email`,
`email:<domain>`): das macht die **Genauigkeit pro Quelle** auf dem Dashboard
**messbar**. JD verpflichtend (SC-02): wenn du sie nicht abrufen kannst, erfinde
sie nicht.

## Balancierung (Urteil des Capitano, C-16)

Lesen ist gratis (`poll`/`count`), die **Verarbeitung** bis zum Score kostet. Der
Entscheider ist der Capitano, keine Formel:
- Vernuenftiges Volumen → alle verarbeiten (mehr Signal ist besser).
- Flood → nur die **markanten** weiterfuehren, mit zwei Kriterien allein aus den
  Metadaten (gratis): **(1) Match mit dem Profil/Ziel** des Benutzers
  (Rolle/Keyword im `subject`/Titel) und **(2) Frische** (`received_at` aktueller).
  Die anderen werden in den folgenden Fenstern wieder aufgegriffen.
- Ziel: die Positionen **erreichen einen Score**, sie haeufen sich nicht
  unbewertet an. Keine festen Schwellen — der Capitano entscheidet wie viele je
  nach Budget.

## Anti-Pattern

- ❌ Haeufiger als ~30 Min pollen (IMAP-Rate-Limit, keine neuen Alerts).
- ❌ INSERT ohne vollstaendige JD (SC-02) oder ohne das `source`-Tag.
- ❌ Bei Flood lawinenartig erstellen und das Urteil des Capitano (C-16) ignorieren:
  das blaeht die Warteschlange mit Positionen auf, die nie einen Score erreichen.
- ❌ Das Dedup umgehen (SC-05): die gleichen Alerts wiederholen sich jeden Tag.

## Siehe auch

- `position-insert` — die 5 Gates des INSERT (dein Standard-Ablauf).
- `scout-coord` — Claim der Quelle `email:*` beim Boot (Anti-Kollision).
- `circles-and-sources` — das Web-Sourcing, NACH der E-Mail zu Tagesbeginn zu machen.
