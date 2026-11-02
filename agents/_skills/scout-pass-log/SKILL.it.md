---
name: scout-pass-log
description: "Misura le tue ricerche, così la squadra capisce se una fonte è esaurita o se la ricerca è fatta male. Dopo ogni ricerca su una fonte scrivi quanti candidati sono tornati; quando un candidato esce dai gate scrivi dove è finito. Due comandi brevi, vocabolario chiuso, mai testo libero."
allowed-tools: Bash(python3 /app/shared/skills/scout_pass_log.py *)
---
<!-- @translation: it, ai-translated 2026-11-02 -->

# scout-pass-log — misura cosa restituiscono le tue ricerche

Da fuori nessuno può dire se le fonti di un profilo sono esaurite o se lo Scout cerca male: un candidato scartato prima dell'INSERT (link morto, un filtro, una lingua vista nell'annuncio) non lasciava traccia. Questi due comandi lasciano una riga breve ciascuno. Non costano niente e non fermano mai il tuo lavoro.

## Quando

- **Dopo ogni ricerca su una fonte** (è tornata una lista di candidati): il comando `pass`.
- **Quando ogni candidato esce dai gate** (inserito, o scartato e perché): il comando `candidate`. Aggiungi `--opened` se hai scaricato la JD completa (il passo costoso).

## Comandi

```bash
python3 /app/shared/skills/scout_pass_log.py pass --source greenhouse --country nl --returned 25 \
    --query-kind role --query "<the query you searched>"
python3 /app/shared/skills/scout_pass_log.py candidate --source greenhouse --country nl --outcome language --opened
python3 /app/shared/skills/scout_pass_log.py candidate --source greenhouse --country nl --outcome inserted --opened
```

## Vocabolario chiuso

`--source`: lo stesso slug che dai a `--source` dell'INSERT (`linkedin`, `greenhouse`, ...). `--country`: due lettere (`nl`), oppure `multi` / `remote`. `--query-kind`: `role` · `role_language` · `broad` · `synonym` · `level` · `city` · `company` · `generic` · `other`. `--outcome`: `inserted` · `duplicate` · `dead_link` · `closed_ad` · `seniority` · `work_auth` · `domain` · `experience` · `language` · `role` · `area` · `other`.

## Regole

- Il testo libero viene rifiutato (uscita 2, niente scritto): mai un titolo, un'azienda, un nome o qualcosa del profilo in un campo. La query che hai cercato va in `--query` solo per essere ridotta a hash; il suo testo non viene mai salvato.
- Se viene rifiutato, correggi il valore e richiama. Mai saltare la ricerca o il candidato per questo.
- `language` è l'esito di un candidato che scarti perché l'annuncio richiede una lingua che l'utente non parla, che tu l'abbia vista nella lista o nella JD.
- Una chiamata per ricerca e una per candidato, nella stessa chiamata di shell del gate che ha deciso, quando puoi.
- Ogni annuncio che scarti in locale dopo aver letto una lista ha il suo motivo nel registro, mai il silenzio: titolo fuori dai ruoli del profilo → `role`, luogo fuori dalle sue aree → `area`, e gli altri (`seniority`, `language`, `experience`, `domain`, `work_auth`). Per molti annunci con lo stesso motivo NON chiamare una volta per annuncio: `candidate --source S --country CC --outcome role --count 640` è UNA riga che ne vale 640 (da 1 a 100000; mai con `inserted` e mai con `--opened`, che è una riga ciascuno). Un portale che risponde 403, un muro di login o 410: `pass ... --returned 0 --status closed` (`gone` per il 410, `empty` per una lista vuota). La colonna `unexpl` del report è ciò che il portale ha restituito e nessuno ha spiegato: deve arrivare a 0.
