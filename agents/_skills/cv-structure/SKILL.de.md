<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: cv-structure
description: Das CV-Markdown schreiben, das als PDF gerendert und vom Critico geprüft wird. Sechs feste Abschnitte, max. 2 Seiten, jede Behauptung rückverfolgbar zu `candidate_profile.yml` (null Erfindungen — T10). Aufzählungspunkte folgen dem Muster "Metrik fett + Tech in Klammern"; Ton passt zum Firmentyp der JD (Startup/Konzern/Fintech); Anschreiben nur wenn die JD es explizit verlangt. Zuständig: Scrittore. Zusammen mit `application-flow` (Beanspruchung + Pfad) und `critic-loop` (Review-Iterationen).
allowed-tools: Bash(pandoc *)
---

# cv-structure — das kanonische CV-Layout

Ausgabe geht nach `$JHT_USER_DIR/cv/CV_<Candidato>_<Company>.md` (dann PDF via pandoc/typst). Pfadregel: `application-flow`-Skill — niemals den finalen CV unter `$JHT_AGENT_DIR` schreiben (das ist nur Scratch, T11).

`<Candidato>` = `Nome_Cognome` aus dem Profil. `<Company>` = Firmenname normalisiert PascalCase, keine Leerzeichen oder Schrägstriche (z.B. `Acme_Corp` → `AcmeCorp`).

## Die 6 Abschnitte (feste Reihenfolge, max. 2 Seiten)

| # | Abschnitt          | Länge         | Inhalt                                                                                          |
|---|--------------------|---------------|--------------------------------------------------------------------------------------------------|
| 1 | **Kopfzeile**      | 4-6 Zeilen    | Name, auf die JD ausgerichteter Rollentitel, Kontakte (E-Mail/Telefon/LinkedIn/GitHub), Sprachen (GER) |
| 2 | **Über mich**      | 2-3 Zeilen    | Konkrete Glaubwürdigkeit. **NIEMALS** generische Phrasen ("leidenschaftlich für", "ergebnisorientiert") |
| 3 | **Erfahrung**      | 4-5 Unter     | Jeder Unterblock = eine Erfahrung, abgebildet auf **eine spezifische JD-Anforderung**. Aufzählungspunkte: Metrik + Tech |
| 4 | **Technische Skills** | 1 Tabelle   | Entspricht JD-Schlüsselwörtern. Nur Tech, die tatsächlich im Profil dokumentiert ist.            |
| 5 | **Ausbildung**     | 2-4 Zeilen    | Exakte Titel aus dem Profil. Nicht für fehlende Abschlüsse entschuldigen.                        |
| 6 | **Nebenprojekte**  | 0-3 Unter     | Nur wenn sie den JD-Fit verstärken. Abschnitt komplett weglassen wenn nichts passt.              |

## Abschnitt 1 — Kopfzeile

```markdown
# <Vorname Nachname>
**<Auf die JD ausgerichteter Rollentitel>** · <Stadt, Land>
✉️ <email> · 📱 <telefon> · 🔗 linkedin.com/in/<handle> · 💻 github.com/<handle>
🗣 <Sprache1 (Level)>, <Sprache2 (Level)>
```

Den Rollentitel anpassen: wenn die JD "Backend Engineer (Python)" sagt, das verwenden, nicht das generische Profilziel. Wahrheitsgetreu bleiben — niemals eine Seniorität beanspruchen, die du nicht hast.

## Abschnitt 2 — Über mich

2-3 Zeilen. Der Nutzer ist eine echte Person, die echte Dinge getan hat; das in 30-50 Wörtern zeigen. Verbotene Phrasen:

| ❌ Verboten                            | ✅ Ersetzen durch                                            |
|----------------------------------------|--------------------------------------------------------------|
| "Leidenschaftlich für <X>"             | eine Tatsache: "5 Jahre <X> in Produktion gebaut"            |
| "Ergebnisorientierter Profi"           | eine Zahl: "P95-Latenz von 320ms auf 110ms über 3 Services reduziert" |
| "Suche eine Gelegenheit zu wachsen"    | komplett weglassen; die Bewerbung selbst signalisiert das    |
| "Detailorientierter Teamplayer"        | ein Beispiel geben oder weglassen                            |

## Abschnitt 3 — Erfahrung

Der schwierigste Abschnitt. Jeder Unterblock ist **eine Erfahrung**, abgebildet auf **eine JD-Anforderung**.

```markdown
### <Rolle> @ <Firma> — <Mär 2022 – heute>
- **Kaltstart-Zeit von 4,2s auf 0,8s reduziert** durch Neuschreiben der Bootstrap-Schicht (Python, asyncio, uvloop)
- **3 kundenorientierte Datenprodukte ausgeliefert** mit Ownership des Full Stack (FastAPI, Postgres, dbt, Airflow)
- **2 Junior-Backend-Engineers gecoacht** durch ihre ersten Produktions-Incidents
```

Aufzählungspunkt-Regeln:
- **Metrik fett** am Anfang (Zahl, %, Zeit, Skalierung)
- **Tech in Klammern** am Ende des Aufzählungspunkts
- **Aktionsverb** als erstes Wort (siehe verboten/erlaubt-Liste unten)
- Eine Zeile pro Aufzählungspunkt. Wenn er umbricht, packst du zu viel rein.
- 3-5 Aufzählungspunkte pro Erfahrung. Weniger = die Erfahrung sieht dünn aus; mehr = Rauschen.

### Aktionsverben

| ✅ Verwenden                                          | ❌ Verboten                     |
|-------------------------------------------------------|---------------------------------|
| Built, Architected, Shipped, Engineered, Reduced,     | learned, studied, assisted,     |
| Migrated, Designed, Owned, Mentored, Scaled, Cut       | helped, was involved in,        |
|                                                       | participated in, was responsible for |

Verbotene Verben signalisieren eine junior/unsichere Stimme. Verwende die aktive Liste auch wenn die Rolle junior war — fokussiere auf das, was du *geliefert* hast, nicht was du *getan* hast.

## Abschnitt 4 — Technische Skills

Eine 2-spaltige Markdown-Tabelle, die die Schlüsselwort-Liste der JD spiegelt. **Nur Tech, die das Profil tatsächlich dokumentiert.** Ein Tool erfinden, das du nicht kennst, ist ein sofortiger Fail im Critic-Review (und ein realer Kündigungsgrund).

```markdown
| Bereich           | Stack                                                  |
|-------------------|--------------------------------------------------------|
| Sprachen          | Python, Go, Bash                                       |
| Backend           | FastAPI, Django, gRPC                                  |
| Daten             | PostgreSQL, Redis, dbt, Airflow                        |
| Infra             | Docker, GitHub Actions, AWS (EC2, S3, RDS)             |
```

Kategorien sollten dem entsprechen, was die JD betont. Wenn die JD nie Infra erwähnt, diese Zeile weglassen oder komprimieren.

## Abschnitt 5 — Ausbildung

```markdown
### <Abschluss>, <Institution> — <Jahr>
<einzeilige Notiz: Notendurchschnitt nur wenn > 28/30 ≈ 3.5/4, Thema der Abschlussarbeit nur wenn für die JD relevant>
```

Wenn der Kandidat keinen Abschluss hat:
- **Nicht entschuldigen** ("derzeit dabei", "Autodidakt stattdessen"). Entschuldigen signalisiert Schwäche.
- Relevante Zertifizierungen, Bootcamps, Online-Programme als eigene Einträge auflisten.
- Den Erfahrungsabschnitt das Gewicht tragen lassen.

## Abschnitt 6 — Nebenprojekte (optional)

NUR einschließen wenn ein Projekt den JD-Fit klar verstärkt. Gleiches Aufzählungspunkt-Muster wie Erfahrung.

```markdown
### <Projektname> — <github link>
- **<Metrik / Ergebnis>** (<Tech-Stack>)
- Einzeilige Beschreibung was es tut und warum es relevant ist
```

Wenn nichts passt, **den Abschnitt komplett weglassen**. Leere Polsterung signalisiert Substanzmangel.

## Ton nach Firmentyp (aus JD-Signalen)

| Firmentyp    | Ton                                           | Signale in der JD                                                |
|--------------|-----------------------------------------------|--------------------------------------------------------------|
| Startup      | Selbstbewusst, ownership-lastig, direkt, Aktionsverben zuerst | "fast-paced", "wear many hats", "early-stage", kleine Teamgröße |
| Konzern      | Professionell, strukturiert, prozessbewusst    | "stakeholders", "cross-functional", größeres Team, klar definierte Prozesse |
| Fintech / reguliert | Compliance-bewusst, präzise, Frameworks zitieren (PCI-DSS, SOC 2, ISO 27001) | Erwähnung von Audits, Regulierern, Compliance-Teams |
| Agentur      | Vielseitig, kundenorientiert, Breite über Tiefe | "varied projects", "client-facing", "delivery"              |

Nicht übertreiben — Ton ist eine Farbe, kein Kostüm. Die Aufzählungspunkte bleiben in jedem Fall faktisch.

## Anschreiben (nur wenn die JD es verlangt)

Standard: **keines schreiben**. Token + Zeit gespart. Nur schreiben wenn die JD es explizit erwähnt ("please include a cover letter", "tell us why you want this role").

Länge: 250-400 Wörter. Pfad: `$JHT_USER_DIR/allegati/CoverLetter_<Candidato>_<Company>.{md,pdf}`.

```markdown
Eröffnung (direkt, NICHT "Hiermit möchte ich mein Interesse bekunden"):
"Ich bewerbe mich auf <Rolle> weil <3-4 konkrete Belege, die zur JD passen>."

Mitte (1-2 Absätze):
- Eine spezifische vergangene Leistung, die auf den Hauptschmerzpunkt der JD abbildet
- Eine Sache, die du an der Firma bemerkt hast, die über ihre Landingpage hinausgeht

Schluss:
- Eine vorausschauende Zeile: was du in den ersten 90 Tagen tun möchtest
- "Gerne bespreche ich das ausführlicher."
```

In Anschreiben verboten:
- "Hiermit möchte ich mein Interesse bekunden…" → beginnt mit Aufwand und endet mit nichts
- "Bitte finden Sie anbei meinen Lebenslauf…" → es ist eine Bewerbung, natürlich ist er angehängt
- "Es wäre mir eine Ehre…" → Konzernklischee

## PDF-Generierung — Engine + atomares Schreiben + DB UPDATE (W-03, Bug #26)

### Engine: `wkhtmltopdf` (NICHT typst, NICHT fpdf2)

Technische Entscheidung 2026-05-18 nach Untersuchung "CV-Ästhetik vereinfacht":

- **`wkhtmltopdf 0.12.6` (Qt 5.15.8)** → offizielle Engine, bereits im
  Container installiert. Produziert professionelle HTML+CSS-CVs, 2 Seiten, ~30 KB
  (Output identisch zu den "schönen" CVs vom 16. Mai).
- ❌ **NICHT `--pdf-engine=typst` verwenden**: typst ist in
  pandoc 2.17 des Containers nicht verfügbar (würde pandoc 3.x erfordern). Historischer
  Fehler im Skill, gemeldet 2026-05-18.
- ❌ **NICHT `pdf_gen.py` (fpdf2)** für CVs verwenden: ist nur Fallback
  Minimalist 80% einfache Fälle. Für nutzerorientierte CVs produziert es
  spartanisches 1-Seiten-Layout, kein CSS, kein Fein-Spacing.

Das historische Anti-Pattern: PDF direkt in
`$JHT_USER_DIR/cv/` generieren, dann `db_update.py application --cv-pdf-path
...` separat ausführen. Wenn der Sentinel den Writer zwischen den beiden
Schritten beendete (EMERGENZA Freeze 2026-05-17 04:43), blieb das PDF auf der Festplatte, aber
die DB hatte `cv_pdf_path=NULL`. Sisal 7.5/10 PASS wurde *"CV zu
schreiben"* auf dem Dashboard für den Nutzer — unsichtbare Top-Gelegenheit.

Fix: Temporärdatei + Größen-Gate + atomares mv + Single-Shot UPDATE. Wenn das
UPDATE fehlschlägt, die finale Datei entfernen, damit kein Waise bleibt.

```bash
# Finaler Dateiname enthält position_id, damit 2 Stellen @ gleicher Firma nicht kollidieren (Bug #25)
SRC_MD="$JHT_USER_DIR/cv/CV_${CANDIDATO}_${POSITION_ID}_${COMPANY_SLUG}_${TITLE_SLUG}.md"
FINAL_PDF="$JHT_USER_DIR/cv/CV_${CANDIDATO}_${POSITION_ID}_${COMPANY_SLUG}_${TITLE_SLUG}.pdf"
TMP_PDF="$(mktemp -t cv_${POSITION_ID}.XXXXXX.pdf)"

# ── PREFLIGHT ─────────────────────────────────────────────────────────
# Explizite Prüfung, dass die Engine verfügbar ist VOR pandoc.
# Ohne diese Prüfung, bei veralteter Skill (typst nicht vorhanden, pandoc 3.x
# fehlt, …) führte der Scrittore den Befehl aus, scheiterte, improvisierte
# zufälligen Fallback → hässliche CVs vom 2026-05-18 Morgen.
if ! command -v wkhtmltopdf >/dev/null 2>&1; then
  echo "[cv-structure] ABORT preflight: wkhtmltopdf nicht verfügbar."
  echo "  Akzeptable alternative Engines: weasyprint (pandoc --pdf-engine=weasyprint)."
  echo "  NIEMALS Fallback auf pdf_gen.py / fpdf2 für CVs (hässlicher Output)."
  echo "  Das Problem dem Capitano via [REPORT] melden und ABBRECHEN."
  exit 2
fi

# 1. Rendern via pandoc → html → wkhtmltopdf (siegende Engine, 32 KB / 2 Seiten).
#    --metadata title=... vermeidet die Warnung von wkhtmltopdf "no title element".
pandoc "$SRC_MD" -o "$TMP_PDF" \
       --pdf-engine=wkhtmltopdf \
       --metadata title="CV $CANDIDATO"

# ── GATE POST-RENDER: Größe + Producer ─────────────────────────────────
# ZWEI verpflichtende Prüfungen. KEINE der beiden ist optional.
#
# Prüfung A) Größe: < 20 KB deutet auf falsche Engine (fpdf2 ~22 KB aber 1 Seite
# spartanisch, wkhtmltopdf ≥30 KB mit vollem HTML+CSS). Schwelle 20 KB OK zum
# Unterscheiden.
size=$(stat -c%s "$TMP_PDF" 2>/dev/null || stat -f%z "$TMP_PDF")
if [ ! -s "$TMP_PDF" ] || [ "$size" -lt 20000 ]; then
  echo "[cv-structure] ABORT post-render: PDF $size B verdächtig (erwartet ≥20 KB)."
  echo "  Wahrscheinlich falsche Engine (fpdf2 minimalistisch statt wkhtmltopdf)."
  rm -f "$TMP_PDF"
  exit 3
fi

# Prüfung B) Producer: muss wkhtmltopdf sein (= 'Qt 5.15.8' oder ähnlich).
# Wenn es 'fpdf2' / leer / '?' ist, war die Engine NICHT wkhtmltopdf — das PDF
# kommt trotzdem raus aber wird hässlich. ABORT laut, damit der Capitano es sieht.
producer=$(python3 -c "
from pypdf import PdfReader
import sys
try:
    r = PdfReader('$TMP_PDF')
    m = r.metadata or {}
    print(m.get('/Producer', ''))
except Exception as e:
    print('?'); sys.exit(1)
" 2>/dev/null)
case "$producer" in
  *Qt*)
    : # OK, wkhtmltopdf hat gearbeitet
    ;;
  *)
    echo "[cv-structure] ABORT post-render: Producer='$producer' (erwartet 'Qt 5.x.x')."
    echo "  Die tatsächliche Engine war NICHT wkhtmltopdf — Output nicht professionell."
    rm -f "$TMP_PDF"
    exit 4
    ;;
esac

# 3. Atomares Verschieben + UPDATE in Sequenz; Rollback wenn UPDATE fehlschlägt
mv "$TMP_PDF" "$FINAL_PDF"
if ! python3 /app/shared/skills/db_update.py application "$POSITION_ID" \
        --cv-pdf-path "$FINAL_PDF" --written-at now; then
  echo "[cv-structure] DB UPDATE fehlgeschlagen, entferne PDF um keine Waisen zu lassen"
  rm -f "$FINAL_PDF"
  exit 1
fi
```

Exit-Codes:
- `0` → CV OK, DB aktualisiert, bereit für critic-loop
- `2` → Preflight FAIL (Engine nicht verfügbar) — dem Capitano melden
- `3` → Post-Render FAIL (Größe < 20 KB, minimalistischer Output) — falsche Engine
- `4` → Post-Render FAIL (Producer != Qt) — falsche Engine
- `1` → DB UPDATE FAIL (Datei-Rollback)

Der Dottore erkennt via `cv-disk-audit` Healthcheck (Bug #18) eventuelle
Waisen Festplatte↔DB; außerdem meldet er jetzt auch CVs mit Nicht-Qt-Producer als
"falsche Engine — regenerieren".

## Pre-Generierungs-Status-Gate (W-04, Bug #26)

Vor dem Ausführen von pandoc überprüfen, ob die Position noch Scoring-tauglich ist.
Manchmal markiert der Analyst `excluded` *nachdem* der Writer die
Position beansprucht hat (Race Condition) und der Writer schreibt weiter — 3 CVs
verschwendet auf Canonical ContainerImages / K8s / Deloitte in den Dumps vom
2026-05-17.

```bash
status=$(python3 /app/shared/skills/db_query.py position "$POSITION_ID" --field status)
case "$status" in
  excluded|rejected)
    echo "[cv-structure] Position #$POSITION_ID ist $status, überspringe CV-Generierung"
    exit 0
    ;;
esac
```

## Strenge Regeln

- **Null Erfindungen.** Jede Metrik, jede Tech, jedes Projekt muss auf `candidate_profile.yml` oder die vom Nutzer bereitgestellten Quellen zurückverfolgbar sein. Erfinden besteht beim Critic nicht und ist im echten Leben ein Kündigungsgrund. T10.
- **Per JD maßschneidern.** Derselbe Kandidat bekommt einen anderen CV pro Rolle: anderes Über-mich, andere Erfahrungsschwerpunkte, andere Skills-Reihenfolge. Generische CVs bestehen das Score-Gate nicht.
- **Eine Anforderung → ein Erfahrungsblock.** Wenn die JD 5 Anforderungen hat und dein Erfahrungsabschnitt auf 2 abbildet, erzählst du nicht die richtige Geschichte.
- **Max. 2 Seiten.** Recruiter überfliegen. Wenn Seite 3 existiert, kürzen.

## Anti-Patterns

- ❌ Generisches Über-mich ("leidenschaftlicher Entwickler mit starken Skills") — sofortiger Kill im Critic-Review.
- ❌ Skills-Tabelle mit Tech, die nicht im Profil dokumentiert ist — Erfindung, T10-Verletzung.
- ❌ Für fehlenden Abschluss / Jahre entschuldigen — signalisiert Schwäche.
- ❌ Gleicher CV über mehrere JDs — Score-Gate bestraft generische CVs.
- ❌ Anschreiben wenn nicht verlangt — verschwendete Token, längerer Review-Zyklus, kein Wert.
- ❌ Mehr als 5 Aufzählungspunkte pro Erfahrung — Recruiter überfliegen, der Aufmacher-Aufzählungspunkt verliert seine Wirkung.

## Siehe auch

- `application-flow` — Beanspruchung + Pfad + UPSERT BEVOR du eine einzige Zeile CV schreibst.
- `critic-loop` — das 3-Runden Blind-Review, das folgt. Die `Concrete Actions` zwischen Runden anwenden.
- `agents/_team/team-rules.md` T10 (Profil nur lesen) + T11 (Ergebnisse in `$JHT_USER_DIR`).
- `agents/scrittore/scrittore.md` — der Orchestrator-Prompt, der diesen Skill in der Hauptschleife aufruft.
