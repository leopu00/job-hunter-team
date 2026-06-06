<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: parse-cv
description: Vorverarbeitung einer CV/Profil-Datei (PDF, DOCX, ODT, RTF) in Klartext VOR dem Einspeisen in den LLM-Kontext. Reduziert Token-Kosten um 5-10x bei langen CVs und liefert zuverlässigere Extraktion als das direkte Lesen binärer PDFs via multimodaler Vision. Der Assistente ruft diesen Skill bei jedem hochgeladenen Dokument in `$JHT_HOME/profile/sources/` auf, bevor `candidate_profile.yml` befüllt wird. Für Bilder (jpg/png von Papier-CV) diesen Skill überspringen — sie direkt via Vision lesen (das LLM ist multimodal). Für nicht unterstützte Formate gibt der Skill einen Exit-Code ungleich Null zurück und der Assistente bittet den Nutzer um eine Alternative.
allowed-tools: Bash(pdftotext *), Bash(pandoc *), Bash(file *), Bash(test *), Bash(cat *), Bash(wc *), Bash(head *)
---

# parse-cv — Textextraktion aus vom Nutzer hochgeladener Datei

Der Nutzer lädt seinen CV via Telegram (oder Web-Drop-Zone) hoch. Der Assistente
muss die strukturierten Daten (Name, Rolle, Skills, Erfahrungen) extrahieren, um
`$JHT_HOME/profile/candidate_profile.yml` zu befüllen.

**Ohne Vorverarbeitung**: Das LLM empfängt die binäre PDF via Read-Tool und
macht das Parsing direkt. Funktioniert, aber:
- Kostet viele Token (ein CV mit 2 Seiten ≈ 3-5k Token nur für die Datei)
- Variable Ergebnisse bei gescannten PDFs / Nicht-Standard-Formaten
- Stiller Fehler bei .pages/.numbers (Apple-Formate, nicht lesbar)

**Mit Vorverarbeitung** (dieser Skill): pdftotext/pandoc extrahieren den
Klartext in 50-200ms, das LLM empfängt nur den Text (500-2000 Token).
Fünf- bis zehnmal weniger Token, zuverlässigeres Parsing.

## Wann starten

Der Assistente ruft parse-cv auf:
1. Bei jeder neuen Datei in `$JHT_HOME/profile/sources/` mit Erweiterung
   `.pdf .docx .doc .odt .rtf .txt`
2. **NICHT** bei Bildern (`.jpg .jpeg .png .heic .webp`) — die
   liest er direkt via multimodale Vision des LLM
3. **NICHT** bei Dateien >5 MB (wahrscheinlich keine CVs — der Assistente
   bittet um Klärung)

## Verfügbare Werkzeuge im Container

Bereits installiert (mit `command -v` überprüfen):
- `pdftotext` (via `poppler-utils`) — PDF → Text
- `pandoc` — docx/odt/rtf/html → text/markdown
- `file` — MIME-Typ erkennen
- NICHT verfügbar: `tesseract` (OCR), `unrtf` — für Scans mit niedriger
  Qualität fällt das LLM auf multimodale Vision zurück oder bittet den Nutzer um Wiederholung

## Vorgehen

```bash
SRC="$1"   # Pfad zur Datei in profile/sources/
[ -f "$SRC" ] || { echo "ERROR: Datei nicht gefunden: $SRC"; exit 2; }

# 1. MIME erkennen
MIME="$(file -b --mime-type "$SRC")"

# 2. Größenprüfung (5 MB Limit)
SIZE=$(stat -c%s "$SRC" 2>/dev/null || stat -f%z "$SRC")
if [ "$SIZE" -gt 5242880 ]; then
  echo "ERROR: Datei >5MB ($SIZE bytes), skip parse"
  exit 3
fi

# 3. Extraktion nach Format
case "$MIME" in
  application/pdf)
    # PDF: pdftotext versuchen (Layout beibehalten für tabellarische CVs)
    OUT="$(pdftotext -layout -nopgbrk "$SRC" - 2>/dev/null)"
    if [ -z "$OUT" ] || [ "${#OUT}" -lt 50 ]; then
      # Wahrscheinlich gescanntes PDF (Bilder, keine Textebene)
      echo "ERROR: PDF-Textebene leer (wahrscheinlich Scan). Multimodale Vision verwenden oder Nutzer um Wiederholung bitten."
      exit 4
    fi
    ;;
  application/vnd.openxmlformats-officedocument.wordprocessingml.document|\
  application/msword|\
  application/vnd.oasis.opendocument.text|\
  application/rtf|\
  text/rtf)
    # Word/ODT/RTF: pandoc → Klartext
    OUT="$(pandoc -f auto -t plain --wrap=none "$SRC" 2>/dev/null)"
    if [ -z "$OUT" ]; then
      echo "ERROR: pandoc kann Text aus $SRC ($MIME) nicht extrahieren"
      exit 5
    fi
    ;;
  text/plain|text/markdown)
    OUT="$(cat "$SRC")"
    ;;
  *)
    echo "ERROR: MIME-Typ nicht unterstützt: $MIME"
    echo "       Unterstützte Formate: pdf, docx, doc, odt, rtf, txt, md"
    echo "       Für Bilder multimodale Vision direkt verwenden."
    exit 6
    ;;
esac

# 4. Extrakt ausgeben
echo "$OUT"
```

## Exit-Codes

| Code | Bedeutung | Aktion des Assistenten |
|------|-------------|-------------------|
| 0 | Extraktion OK, Text auf stdout | Mit LLM-Parsing auf dem Text fortfahren |
| 2 | Datei nicht gefunden | Interner Bug, loggen + überspringen |
| 3 | Datei >5 MB | Nutzer fragen: "Diese Datei ist groß, ist das wirklich ein CV? Schick mir nur den CV." |
| 4 | PDF ohne Textebene (Scan) | Fallback: PDF via multimodale Vision lesen (das LLM "sieht" das Bild). Wenn auch das fehlschlägt, um Wiederholung bitten: "Der Scan ist schlecht lesbar, kannst du ein schärferes Foto machen oder mir die originale Word/PDF-Datei schicken?" |
| 5 | pandoc-Fehler | Fragen: "Die Datei scheint beschädigt. Kannst du sie nochmal exportieren?" |
| 6 | MIME nicht unterstützt (z.B. `.pages` Apple) | Fragen: "Ich kann das Format nicht lesen. Kannst du es als PDF exportieren und nochmal schicken?" |

## Erwartete Ausgabe

Klartext mit wo möglich beibehaltener Formatierung (wichtig für CVs
mit Tabellen/Spalten). Der Skill macht KEIN semantisches Parsing — das ist
Aufgabe des LLM-Assistenten danach, beim Lesen des stdout dieses Skills.

Beispielaufruf:

```bash
TEXT="$(bash /app/agents/_skills/parse-cv/extract.sh "$JHT_HOME/profile/sources/cv-marco.pdf")"
RC=$?
case $RC in
  0) # $TEXT an das LLM übergeben um candidate_profile.yml zu befüllen
     ;;
  4) # PDF-Scan: via multimodale Vision des LLM lesen
     ;;
  3|5|6) # Nutzer um Wiederholung bitten via telegram-send
     ;;
esac
```

## Design-Notizen

- **Kein explizites OCR** (kein Tesseract): fügt ~200 MB zum Docker-
  Image hinzu und das multimodale LLM deckt den Scan-Fall bereits gut ab.
- **Keine Spracherkennung**: Das LLM ist mehrsprachig und verarbeitet CVs
  in jeder Sprache (siehe `agents/assistente/assistente.md` § CV-
  Upload — Regel "in Nutzersprache antworten, Daten bleiben in Original-
  sprache des CV").
- **Keine größenbasierte Kürzung**: Das 5 MB-Limit ist Anti-Missbrauch, nicht
  für echte CVs (ein seriöser CV ist 200 KB-2 MB).
- **Skill parallel aufrufbar**: idempotent, kein externer State
  verändert (der Skill LIEST nur die Datei und gibt aus).
