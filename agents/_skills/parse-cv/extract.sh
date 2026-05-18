#!/usr/bin/env bash
# parse-cv/extract.sh — estrae testo plain da CV (PDF/DOCX/ODT/RTF/TXT).
#
# Usage:
#   bash /app/agents/_skills/parse-cv/extract.sh <path-to-file>
#
# Exit codes (vedi SKILL.md per il significato e azione Assistente):
#   0  → testo su stdout, OK
#   2  → file non trovato
#   3  → file >5 MB
#   4  → PDF senza text layer (scansione)
#   5  → pandoc failure (file corrotto?)
#   6  → MIME non supportato
#
# Per immagini (.jpg/.png/.heic): NON usare questa skill, il LLM
# multimodal le legge direttamente via Read tool.

set -u

SRC="${1:-}"
if [ -z "$SRC" ]; then
  echo "ERROR: usage: extract.sh <path-to-file>" >&2
  exit 2
fi
if [ ! -f "$SRC" ]; then
  echo "ERROR: file non trovato: $SRC" >&2
  exit 2
fi

# Detect MIME via `file`
MIME="$(file -b --mime-type "$SRC" 2>/dev/null || echo "")"

# Size check (5 MB anti-abuse)
SIZE=$(stat -c%s "$SRC" 2>/dev/null || stat -f%z "$SRC" 2>/dev/null || echo 0)
if [ "$SIZE" -gt 5242880 ]; then
  echo "ERROR: file >5MB ($SIZE bytes), skip parse" >&2
  exit 3
fi

case "$MIME" in
  application/pdf)
    OUT="$(pdftotext -layout -nopgbrk "$SRC" - 2>/dev/null)"
    if [ -z "$OUT" ] || [ "${#OUT}" -lt 50 ]; then
      echo "ERROR: PDF text layer vuoto (probabile scansione). Usa vision multimodal o chiedi retry all'utente." >&2
      exit 4
    fi
    ;;
  application/vnd.openxmlformats-officedocument.wordprocessingml.document|application/msword|application/vnd.oasis.opendocument.text|application/rtf|text/rtf)
    OUT="$(pandoc -f auto -t plain --wrap=none "$SRC" 2>/dev/null)"
    if [ -z "$OUT" ]; then
      echo "ERROR: pandoc non riesce a estrarre testo da $SRC ($MIME)" >&2
      exit 5
    fi
    ;;
  text/plain|text/markdown|text/x-markdown)
    OUT="$(cat "$SRC")"
    ;;
  *)
    echo "ERROR: MIME type non supportato: $MIME" >&2
    echo "       Formati supportati: pdf, docx, doc, odt, rtf, txt, md" >&2
    echo "       Per immagini usa vision multimodal direttamente." >&2
    exit 6
    ;;
esac

printf '%s' "$OUT"
