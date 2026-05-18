---
name: parse-cv
description: Pre-process a CV/profile file (PDF, DOCX, ODT, RTF) into plain text BEFORE feeding it to the LLM context. Reduces token cost by 5-10x on long CVs and yields more reliable extraction than reading binary PDFs directly via multimodal vision. The Assistente calls this skill on every uploaded document in `$JHT_HOME/profile/sources/` before populating `candidate_profile.yml`. For images (jpg/png of paper CV) skip this skill — read them via vision directly (the LLM is multimodal). For unsupported formats the skill exits non-zero and the Assistente asks the user for an alternative.
allowed-tools: Bash(pdftotext *), Bash(pandoc *), Bash(file *), Bash(test *), Bash(cat *), Bash(wc *), Bash(head *)
---

# parse-cv — text extraction da file caricato dall'utente

L'utente carica il suo CV via Telegram (o web drop-zone). L'Assistente
deve estrarre i dati strutturati (nome, ruolo, skill, esperienze) per
popolare `$JHT_HOME/profile/candidate_profile.yml`.

**Senza pre-process**: il LLM riceve il PDF binario via Read tool e
fa il parsing direttamente. Funziona ma:
- Costa tanti token (un CV 2 pagine ≈ 3-5k token solo per il file)
- Risultati variabili su PDF scansionati / formati non-standard
- Errore silenzioso su .pages/.numbers (formati Apple non leggibili)

**Con pre-process** (questa skill): pdftotext/pandoc estraggono il
testo plain in 50-200ms, il LLM riceve solo il testo (500-2000 token).
Cinque-dieci volte meno token, parsing più affidabile.

## Quando lanciarla

L'Assistente chiama parse-cv:
1. Su ogni nuovo file in `$JHT_HOME/profile/sources/` con estensione
   `.pdf .docx .doc .odt .rtf .txt`
2. **NON** sulle immagini (`.jpg .jpeg .png .heic .webp`) — quelle
   le legge direttamente via vision multimodal del LLM
3. **NON** su file >5 MB (probabilmente non sono CV — l'Assistente
   chiede chiarimento)

## Strumenti disponibili nel container

Già installati (verifica con `command -v`):
- `pdftotext` (via `poppler-utils`) — PDF → text
- `pandoc` — docx/odt/rtf/html → text/markdown
- `file` — detect MIME type
- NON disponibile: `tesseract` (OCR), `unrtf` — per scansioni a bassa
  qualità il LLM cade su vision multimodal o chiede retry all'utente

## Procedura

```bash
SRC="$1"   # path al file in profile/sources/
[ -f "$SRC" ] || { echo "ERROR: file non trovato: $SRC"; exit 2; }

# 1. Detect MIME
MIME="$(file -b --mime-type "$SRC")"

# 2. Size check (5 MB limit)
SIZE=$(stat -c%s "$SRC" 2>/dev/null || stat -f%z "$SRC")
if [ "$SIZE" -gt 5242880 ]; then
  echo "ERROR: file >5MB ($SIZE bytes), skip parse"
  exit 3
fi

# 3. Estrazione per formato
case "$MIME" in
  application/pdf)
    # PDF: prova pdftotext (preserve layout per CV tabellari)
    OUT="$(pdftotext -layout -nopgbrk "$SRC" - 2>/dev/null)"
    if [ -z "$OUT" ] || [ "${#OUT}" -lt 50 ]; then
      # Probabile PDF scansione (immagini, no text layer)
      echo "ERROR: PDF text layer vuoto (probabile scansione). Usa vision multimodal o chiedi retry all'utente."
      exit 4
    fi
    ;;
  application/vnd.openxmlformats-officedocument.wordprocessingml.document|\
  application/msword|\
  application/vnd.oasis.opendocument.text|\
  application/rtf|\
  text/rtf)
    # Word/ODT/RTF: pandoc → plain text
    OUT="$(pandoc -f auto -t plain --wrap=none "$SRC" 2>/dev/null)"
    if [ -z "$OUT" ]; then
      echo "ERROR: pandoc non riesce a estrarre testo da $SRC ($MIME)"
      exit 5
    fi
    ;;
  text/plain|text/markdown)
    OUT="$(cat "$SRC")"
    ;;
  *)
    echo "ERROR: MIME type non supportato: $MIME"
    echo "       Formati supportati: pdf, docx, doc, odt, rtf, txt, md"
    echo "       Per immagini usa vision multimodal direttamente."
    exit 6
    ;;
esac

# 4. Print estratto
echo "$OUT"
```

## Codici exit

| Code | Significato | Azione Assistente |
|------|-------------|-------------------|
| 0 | Estrazione OK, testo su stdout | Procedi con parsing LLM sul testo |
| 2 | File non trovato | Bug interno, log + skip |
| 3 | File >5 MB | Chiedi all'utente: "Questo file è grande, è davvero un CV? Mandami solo il CV." |
| 4 | PDF senza text layer (scansione) | Fall-back: leggi il PDF via vision multimodal (il LLM "vede" l'immagine). Se anche quello fallisce, chiedi retry: "La scansione è poco leggibile, puoi rifare una foto più nitida o mandarmi il file originale Word/PDF?" |
| 5 | pandoc failure | Chiedi: "Il file sembra corrotto. Riprovi a esportarlo da %s?" |
| 6 | MIME non supportato (es. `.pages` Apple) | Chiedi: "Non riesco a leggere il formato. Puoi esportarlo come PDF e rimandarmelo?" |

## Output atteso

Plain text con layout preservato dove possibile (importante per CV
con tabelle/colonne). Lo skill NON fa parsing semantico — quello è
job del LLM Assistente dopo, leggendo lo stdout di questa skill.

Esempio di chiamata:

```bash
TEXT="$(bash /app/agents/_skills/parse-cv/extract.sh "$JHT_HOME/profile/sources/cv-marco.pdf")"
RC=$?
case $RC in
  0) # passa $TEXT al LLM per popolare candidate_profile.yml
     ;;
  4) # PDF scansione: leggi via vision multimodal del LLM
     ;;
  3|5|6) # chiedi retry all'utente via telegram-send
     ;;
esac
```

## Note progettuali

- **No OCR esplicito** (no tesseract): aggiunge ~200 MB all'image
  Docker e l'LLM multimodal già copre il caso scansione bene.
- **No language detection**: il LLM è multilingua e gestisce CV
  in qualsiasi lingua (vedi `agents/assistente/assistente.md` § CV
  upload — regola "rispondi in lingua utente, dati restano in lingua
  originale CV").
- **No size-based truncation**: il limite 5 MB è anti-abuse, non
  per CV reali (un CV serio è 200 KB-2 MB).
- **Skill richiamabile in parallelo**: idempotente, no state esterno
  modificato (lo skill SOLO LEGGE il file e printa).
