# Video di presentazione JHT — scaletta (60,5 s · 1280×720 · senza audio)

Generato da `make_presentation.py` (PIL + ffmpeg, impianto ripreso dal promo v0.2.0).
Testo a schermo in **italiano**. Transizioni: xfade 0,5 s tra ogni scena.

| # | Tempo | Scena | Contenuto a schermo |
|---|-------|-------|---------------------|
| 1 | 0:00–0:06 | Hook | "Cercare lavoro è un secondo lavoro." + le tre incombenze quotidiane (bacheche, annunci, CV) |
| 2 | 0:06–0:11 | Reveal | Wordmark "Job Hunter Team" · "una squadra di agenti AI che cerca lavoro per te" · `$ jht team start` con cursore |
| 3 | 0:10–0:17 | La squadra | Illustrazione della riunione (landing-hero) con Ken Burns · "Una squadra vera: ruoli chiari, un Capitano, un budget settimanale da rispettare." |
| 4 | 0:17–0:20 | Gli Scout | Illustrazione + "Perlustrano le bacheche di annunci. Giorno e notte." · barra pipeline in basso |
| 5 | 0:20–0:24 | Gli Analisti | "Leggono ogni annuncio. Estraggono ciò che conta." |
| 6 | 0:23–0:27 | Gli Scorer | "Un punteggio a ogni posizione: quanto è adatta a te, 0-100." + badge animato 0→84/100 |
| 7 | 0:27–0:30 | Gli Scrittori | "CV e lettere cuciti su misura, posizione per posizione." |
| 8 | 0:29–0:32 | I Critici | "Revisione cieca dei documenti. Tre round, senza sconti." |
| 9 | 0:32–0:40 | L'ufficio (il punto emotivo) | Zoom-out sull'ufficio del videogioco (office-reference) · "Non un cruscotto: un ufficio, dentro un videogioco." → "Li guardi lavorare per te, mentre tu fai altro." |
| 10 | 0:40–0:45 | Il sito | Screenshot pubblico e anonimo del case study (mappa Europa) in una finestra browser · "E dal sito la segui ovunque." |
| 11 | 0:44–0:51 | Risultati | KPI da dati pubblici e anonimi (beta tester, 3 giu → 3 lug 2026): 658 posizioni trovate · 520 analizzate e valutate · 307 match forti ≥70 · 71/100 match medio |
| 12 | 0:50–0:55 | Open source | Illustrazione "the box" · "Open source (MIT). Gira in un container sulla tua macchina: i tuoi dati restano tuoi." |
| 13 | 0:54–1:00 | CTA | Wordmark · "gratuito · open source · in beta" · jobhunterteam.ai · github.com/leopu00/job-hunter-team |

## Asset usati (tutti già nel repo, nessun dato personale)

- `web/public/landing-hero.png`, `web/public/the-box.png` — illustrazioni brand
- `web/public/agents-{scouts,analyst,scorer,writer,critic}.png` — ritratti dei ruoli
- `game/docs/reference/office-reference.png` — l'ufficio del videogioco
- `assets/screenshots/beta2-map.png` — case study pubblico e anonimo (stesso screenshot del README)
- Font: JetBrains Mono (brand) da `~/Library/Fonts`

## Rigenerare

```bash
python3 make_presentation.py            # → jht-presentation.mp4 accanto allo script
python3 extract_check_frames.py         # → scenes/check/ fotogrammi di verifica
```

`scenes/` e i `.mp4` sono ignorati da git (vedi `.gitignore`).
