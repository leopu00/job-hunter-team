---
name: scout-language-gate
description: "Scegli paesi e query dalle lingue del profilo e scarta un candidato il cui annuncio richiede una lingua che l'utente non parla PRIMA di scaricare l'annuncio completo. Esegui `plan` una volta e `screen` su ogni candidato da titolo e snippet. Caso reale: 100 candidati su 100 di un portale scartati per lingua dopo il fetch completo."
allowed-tools: Bash(python3 /app/shared/skills/scout_language.py *)
---
<!-- @translation: it, ai-translated 2026-11-02 -->

# scout-language-gate — prima le lingue, poi il fetch

La lingua è il taglio che più spesso uccide un candidato DOPO che la ricerca, il fetch dell'annuncio completo e a volte l'INSERT sono già stati pagati. Questa skill lo applica in codice, prima del fetch, da ciò che la lista mostra già. Non inventa: scarta solo su prove, e una lingua che il profilo parla, un annuncio in inglese o un testo troppo corto per dirlo non vengono mai scartati.

## 1. Pianifica la ricerca

`plan` dà a ogni paese una modalità. `local`: il profilo parla lì una lingua di lavoro. `english_friendly`: i ruoli in inglese sono comuni e il profilo parla inglese: cercalo, aggiungendo i qualificatori che stampa (`English-speaking`, `international team`, `English required`). `english_only`: vale la pena aprire solo annunci in inglese. Non esclude nulla (priorità sì, esclusione no, SC-04): parti dall'`order` che stampa e non spendere le prime passate sui paesi `english_only`. Elenca anche i `portals`: i portali di lavoro scritti nella lingua del loro paese che il profilo non sa leggere (jobs.ch, jobup, jobnet, stepstone-de...) sono `skip`, come EURES in un paese di cui il profilo non parla la lingua (`eures`): non cercarli (`portal --source S --country CC` risponde per uno, uscita 10 = skip). Le liste ATS qui non vengono mai escluse.

## 2. Controlla ogni candidato prima del fetch

Dai a `screen` il titolo e, se la fonte lo mostra, lo snippet. `skip_language` (uscita 10): non scaricarlo; con `--log` lascia già la sua riga nel log delle passate (esito `language`, non aperto). `ok` o `unknown`: prosegui coi gate come sempre. Legge solo il testo della lista: dopo il fetch completo l'annuncio passa dai filtri del Gate 4 e dall'Analista come prima.

```bash
# once, before choosing countries and queries: the plan for THIS profile's languages
python3 /app/shared/skills/scout_language.py plan

# for each candidate, from what the LIST shows, BEFORE you fetch the full ad (exit 10 = drop it)
python3 /app/shared/skills/scout_language.py screen --title "<title>" --snippet "<the list's snippet, if any>" \
    --country nl --source greenhouse --log

# one job board in one country (exit 10 = it is in the language of its country and the profile cannot read it: skip it)
python3 /app/shared/skills/scout_language.py portal --source jobs.ch --country ch
```

## Regole

- Non saltare mai un candidato che `screen` non ha scartato perché ne indovini la lingua: lo strumento scarta su prove, tu no.
- Passa il testo com'è nella lista. La risposta contiene solo codici (`required_language`, `ad_language`, `title_language`) e nulla dell'annuncio viene salvato.
- Nessuna lingua leggibile nel profilo: `screen` risponde `unknown` a tutto e non scarta niente.
