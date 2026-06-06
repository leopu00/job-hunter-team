<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: parse-cv
description: Pre-process a CV/profile file (PDF, DOCX, ODT, RTF) into plain text BEFORE feeding it to the LLM context. Reduces token cost by 5-10x on long CVs and yields more reliable extraction than reading binary PDFs directly via multimodal vision. The Assistente calls this skill on every uploaded document in `$JHT_HOME/profile/sources/` before populating `candidate_profile.yml`. For images (jpg/png of paper CV) skip this skill — read them via vision directly (the LLM is multimodal). For unsupported formats the skill exits non-zero and the Assistente asks the user for an alternative.
allowed-tools: Bash(pdftotext *), Bash(pandoc *), Bash(file *), Bash(test *), Bash(cat *), Bash(wc *), Bash(head *)
---

# parse-cv — szöveg kinyerés a felhasználó által feltöltött fájlból

A felhasználó feltölti az önéletrajzát Telegramon (vagy webes
drag-and-drop felületen) keresztül. Az Asszisztensnek ki kell nyernie
a strukturált adatokat (név, pozíció, készségek, tapasztalatok) a
`$JHT_HOME/profile/candidate_profile.yml` feltöltéséhez.

**Előfeldolgozás nélkül**: az LLM a bináris PDF-et kapja a Read tool-on
keresztül, és közvetlenül elemzi. Működik, de:
- Sok tokent fogyaszt (egy 2 oldalas önéletrajz ≈ 3-5k token csak a fájlra)
- Változó eredmények szkennelt PDF-ek / nem szabványos formátumok esetén
- Csendes hiba .pages/.numbers fájloknál (nem olvasható Apple formátumok)

**Előfeldolgozással** (ez a skill): a pdftotext/pandoc 50-200ms alatt
kinyeri a nyers szöveget, az LLM csak a szöveget kapja (500-2000 token).
Öt-tízszer kevesebb token, megbízhatóbb elemzés.

## Mikor kell elindítani

Az Asszisztens a parse-cv-t hívja:
1. Minden új fájl esetén a `$JHT_HOME/profile/sources/` könyvtárban,
   amelynek kiterjesztése `.pdf .docx .doc .odt .rtf .txt`
2. **NEM** képek esetén (`.jpg .jpeg .png .heic .webp`) — azokat
   közvetlenül az LLM multimodális vision funkciójával olvassa
3. **NEM** 5 MB-nál nagyobb fájlok esetén (valószínűleg nem önéletrajz
   — az Asszisztens felvilágosítást kér)

## Elérhető eszközök a konténerben

Már telepítve (ellenőrizd a `command -v` paranccsal):
- `pdftotext` (a `poppler-utils` csomagon keresztül) — PDF → szöveg
- `pandoc` — docx/odt/rtf/html → szöveg/markdown
- `file` — MIME típus felismerés
- NEM elérhető: `tesseract` (OCR), `unrtf` — gyenge minőségű
  szkennelések esetén az LLM a multimodális vision-re támaszkodik,
  vagy újrapróbálkozást kér a felhasználótól

## Eljárás

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

## Kilépési kódok

| Code | Jelentés | Asszisztens teendője |
|------|----------|----------------------|
| 0 | Kinyerés OK, szöveg az stdout-on | Folytasd az LLM elemzéssel a szövegen |
| 2 | Fájl nem található | Belső hiba, naplózás + kihagyás |
| 3 | Fájl >5 MB | Kérdezd meg a felhasználót: "Ez a fájl nagy, tényleg önéletrajz? Csak az önéletrajzot küldd el." |
| 4 | PDF szövegréteg nélkül (szkennelés) | Tartalék megoldás: olvasd a PDF-et multimodális vision-nel (az LLM "látja" a képet). Ha az is sikertelen, kérj újrapróbálkozást: "A szkennelés nehezen olvasható, tudsz élesebb fotót készíteni vagy elküldeni az eredeti Word/PDF fájlt?" |
| 5 | pandoc hiba | Kérdezd: "A fájl sérültnek tűnik. Meg tudod próbálni újra exportálni a következőből: %s?" |
| 6 | Nem támogatott MIME típus (pl. Apple `.pages`) | Kérdezd: "Nem tudom olvasni ezt a formátumot. Ki tudod exportálni PDF-ként és újra elküldeni?" |

## Várt kimenet

Nyers szöveg, amennyire lehetséges megőrzött elrendezéssel (fontos
táblázatokat/oszlopokat tartalmazó önéletrajzok esetén). A skill NEM
végez szemantikai elemzést — az az LLM Asszisztens feladata a skill
stdout kimenetének feldolgozásakor.

Példa hívás:

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

## Tervezési megjegyzések

- **Nincs explicit OCR** (nincs tesseract): ~200 MB-tal növelné a Docker
  image-et, és az LLM multimodális funkciója már jól lefedi a szkennelés
  esetét.
- **Nincs nyelvfelismerés**: az LLM többnyelvű, és bármilyen nyelvű
  önéletrajzot kezel (lásd `agents/assistente/assistente.md` § CV
  upload — szabály: "válaszolj a felhasználó nyelvén, az adatok maradnak
  az önéletrajz eredeti nyelvén").
- **Nincs méret alapú csonkítás**: az 5 MB-os korlát visszaélés elleni
  védelem, nem valós önéletrajzokra vonatkozik (egy normális önéletrajz
  200 KB-2 MB).
- **A skill párhuzamosan is hívható**: idempotens, nincs módosított
  külső állapot (a skill CSAK OLVASSA a fájlt és kiírja).
