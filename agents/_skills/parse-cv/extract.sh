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
#   5  → lettura fallita: file corrotto, troppo grande una volta aperto, o oltre i tetti di tempo/memoria
#   6  → MIME non supportato
#
# Per immagini (.jpg/.png/.heic): NON usare questa skill, il LLM
# multimodal le legge direttamente via Read tool.

set -u

# The one size limit for an uploaded file (the app's chat_attachment.rs MAX_BYTES is the same number: a test holds them together).
MAX_BYTES=5242880
# What reading one file may cost, whatever is inside it: a 400 KB .docx can unpack to gigabytes (a zip bomb), and
# `timeout` is not on every machine (it is not on the Mac), so the time cap is done here and is the same everywhere.
READ_SECONDS="${EXTRACT_READ_SECONDS:-30}"
READ_MEMORY_KB="${EXTRACT_MEMORY_KB:-1572864}"   # 1.5 GB of address space for the reading tool
UNPACKED_MAX=$((50 * 1024 * 1024))                # all the parts of a Word/OpenDocument file, unpacked
UNPACKED_PART_MAX=$((30 * 1024 * 1024))           # one part
PDF_PAGES=30

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
if [ "$SIZE" -gt "$MAX_BYTES" ]; then
  echo "ERROR: file >5MB ($SIZE bytes), skip parse" >&2
  exit 3
fi

WORK="$(mktemp -d 2>/dev/null || mktemp -d -t extract)" || { echo "ERROR: no temporary folder" >&2; exit 5; }
trap 'rm -rf "$WORK"' EXIT

# limited SECONDS CMD...: the command with a time cap and a memory cap, its output in $WORK/out cut at 400000 bytes,
# its exit code in LIMITED_RC (124 = the time ran out). The cap kills the command itself, not just the shell around it.
limited() {
  local secs="$1" pid killer
  shift
  ( ulimit -v "$READ_MEMORY_KB" 2>/dev/null; exec "$@" ) > "$WORK/raw" 2>/dev/null < /dev/null &
  pid=$!
  ( sleep "$secs"; : > "$WORK/timeout"; kill -KILL "$pid" ) > /dev/null 2>&1 &
  killer=$!
  wait "$pid" 2>/dev/null
  LIMITED_RC=$?
  kill "$killer" > /dev/null 2>&1
  wait "$killer" 2>/dev/null
  if [ -e "$WORK/timeout" ]; then LIMITED_RC=124; fi
  head -c 400000 "$WORK/raw" > "$WORK/out"
  rm -f "$WORK/raw"
}

case "$MIME" in
  application/pdf)
    limited "$READ_SECONDS" pdftotext -l "$PDF_PAGES" -layout -nopgbrk "$SRC" -
    if [ "$LIMITED_RC" -eq 124 ] || [ "$LIMITED_RC" -ge 128 ]; then
      echo "ERROR: il PDF e' troppo pesante da leggere (tempo o memoria oltre il tetto)" >&2
      exit 5
    fi
    OUT="$(cat "$WORK/out")"
    if [ -z "$OUT" ] || [ "${#OUT}" -lt 50 ]; then
      echo "ERROR: PDF text layer vuoto (probabile scansione). Dillo all'utente in chat: incolla il testo del CV o carica un PDF con testo." >&2
      exit 4
    fi
    ;;
  application/vnd.openxmlformats-officedocument.wordprocessingml.document|application/vnd.oasis.opendocument.text|application/rtf|text/rtf)
    # The input format is named: `pandoc -f auto` is not a format ("Unknown input format auto"), so every Word, OpenDocument
    # and RTF file used to fail here with exit 5. --sandbox: the file is not trusted and pandoc reads no other file for it.
    case "$MIME" in
      application/vnd.openxmlformats-officedocument.wordprocessingml.document) FORMAT=docx ;;
      application/vnd.oasis.opendocument.text) FORMAT=odt ;;
      *) FORMAT=rtf ;;
    esac
    # Word and OpenDocument are zip files: read the table of contents before unpacking anything. A file this small that
    # declares gigabytes inside is a zip bomb, and the tool cap below would stop it only after it ate the memory.
    if [ "$FORMAT" != rtf ]; then
      ( ulimit -v "$READ_MEMORY_KB" 2>/dev/null
        python3 -I - "$SRC" "$UNPACKED_MAX" "$UNPACKED_PART_MAX" <<'PY'
import sys, zipfile
src, total_max, part_max = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
try:
    with zipfile.ZipFile(src) as z:
        parts = z.infolist()
        if len(parts) > 20000 or sum(p.file_size for p in parts) > total_max or any(p.file_size > part_max for p in parts):
            sys.exit(1)
except Exception:
    sys.exit(1)
PY
      ) > /dev/null 2>&1 || { echo "ERROR: $SRC non e' un documento valido, o una volta aperto e' troppo grande per essere un CV" >&2; exit 5; }
    fi
    limited "$READ_SECONDS" pandoc --sandbox -f "$FORMAT" -t plain --wrap=none "$SRC"
    if [ "$LIMITED_RC" -eq 124 ] || [ "$LIMITED_RC" -ge 128 ]; then
      echo "ERROR: il documento e' troppo pesante da leggere (tempo o memoria oltre il tetto)" >&2
      exit 5
    fi
    OUT="$(cat "$WORK/out")"
    if [ -z "$OUT" ]; then
      echo "ERROR: pandoc non riesce a estrarre testo da $SRC ($MIME)" >&2
      exit 5
    fi
    ;;
  application/msword)
    echo "ERROR: il vecchio formato .doc non si legge: salvalo come PDF o DOCX" >&2
    exit 6
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

# Prompt boundary (RULE-T16): the extracted document is external data.  The
# canonical uploaded file remains untouched; only stdout, which is consumed by
# the agent, is fenced.
#
# Il recinto lo mette il modulo condiviso, non una copia in bash: da quando il
# marcatore porta un nonce per esecuzione, una seconda implementazione
# stamperebbe un confine diverso da quello che le regole del team descrivono —
# e chi legge non avrebbe modo di sapere quale delle due è la vera.
FENCE="$(dirname "$0")/../../../shared/skills/external_content.py"
printf '%s' "$OUT" | python3 "$FENCE" --label "${EXTRACT_LABEL:-CV_UPLOAD}"
