# Scorer — pesi di scoring per-utente (default nel codice + override da profilo)

**Data:** 2026-07-27 · **Stato:** TODO (non iniziato) · **Origine:** richiesta utente (Leone)

## Problema

I pesi dello Scorer sono **hardcoded nello spec** (`agents/scorer/scorer.*.md`, 8 lingue),
tabella fissa uguale per tutti:

| Dimensione | Peso attuale | Colonna DB |
|---|---|---|
| Stack match | 35 | `stack_match` |
| Seniority/anni | 25 | `experience_fit` |
| Remote/location | 20 | `remote_fit` |
| Salary | 10 | `salary_fit` |
| Strategic (bonus AI/dominio) | 10 | `strategic_fit` |

Sono **stack + anni = 60%**: penalizza profili atipici (es. orchestratori AI con pochi
anni e stack consegnato via agenti) e non è tarabile per utente.

## Obiettivo

1. **Default neutri/medi nel codice** (validi per tutti gli utenti). Proposta:
   `stack_match 25 · experience_fit 20 · remote_fit 20 · salary_fit 20 · strategic_fit 15`
   (somma 100). — *da confermare: è un cambio globale.*
2. **Override per-utente** letto da `candidate_profile.yml → scoring_weights` (il profilo è
   per-utente/per-team, quindi lo scoping è automatico). Se presente, lo Scorer usa quei
   pesi (normalizzati a 100) al posto dei default; altrimenti usa i default della tabella.
3. **UX "ticket":** quando l'utente chiede (chat web / Assistente) "pesa di più X",
   l'Assistente aggiorna `scoring_weights` nel profilo → lo Scorer li applica al giro dopo.

## Implementazione (bozza)

- `agents/scorer/scorer.*.md` (8 file): aggiornare la tabella ai default medi + aggiungere
  l'istruzione: *"se `candidate_profile.yml` contiene `scoring_weights`, usali (normalizzati
  a 100) al posto dei default; altrimenti default tabella"*. Lo Scorer già legge il profilo.
- `agents/assistente/*.md` (opzionale): riga che spiega come gestire le richieste di
  modifica pesi (scrivere/aggiornare `scoring_weights` nel profilo, poi `jht profile validate`).
- Chiave `scoring_weights` già supportata dal profilo (extra key tollerata da
  `validate_profile.py`); valutare se aggiungerla anche allo schema Zod / SKILL profile-schema.

## Decisioni aperte

- I numeri esatti dei default medi (cambio globale per tutti gli utenti).
- Se enforzare la normalizzazione/somma-100 o accettare pesi liberi.

## Note

Nel profilo di Leone `scoring_weights` è già presente (strategic 35 / salary 20 / remote 20
/ stack 15 / anni 10) come **intento**: oggi NON è onorato automaticamente (tabella fissa),
lo è solo semanticamente via `preferences.fit_priorities` che lo Scorer-LLM legge. Questa
feature lo renderebbe effettivo.
