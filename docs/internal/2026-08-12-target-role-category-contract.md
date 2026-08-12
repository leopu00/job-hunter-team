# Contratto categoria ruolo onboarding — versione 1

Stato: approvato il 2026-08-12 per
`[WIN-ROLE-LABELS-HARDCODED-MIXED-LANGUAGE]`.

Questo contratto separa una scelta strutturata del wizard dal testo libero del
profilo. È forward-only: non interpreta retroattivamente dati dell'utente e non
introduce una migrazione.

## 1. Due concetti distinti

`target_role` resta il titolo o obiettivo professionale **testuale e libero**
dell'utente. Non è un enum e non viene tradotto, normalizzato o riscritto.

La scelta a categorie del wizard usa invece il campo strutturato
`target_role_category_id`, con uno dei seguenti ID canonici:

```
software | data | product | design | business | security | other
```

Il dettaglio raccolto al passo successivo usa `target_specialty`. I valori
ammessi dipendono dalla categoria:

| `target_role_category_id` | `target_specialty` ammessi |
|---|---|
| `software` | `backend`, `frontend`, `fullstack`, `platform`, `embedded`, `open` |
| `data` | `data_science`, `ml`, `genai`, `data_engineering`, `research`, `open` |
| `product` | `product`, `project`, `technical_pm`, `delivery`, `founder` |
| `design`, `business`, `security`, `other` | `specialist`, `generalist`, `leadership`, `individual`, `explore` |

Gli ID sono dati di prodotto stabili e indipendenti dalla lingua. Non sono
copy da mostrare all'utente.

## 2. Label localizzate

La label della categoria è esclusivamente presentazione UI e si risolve con la
chiave i18n `onb.a.role.<id>` nella lingua canonica del prodotto. Non viene
copiata in `_draft`, `candidate_profile.yml`, `onboarding_context.json`, nel
contesto Markdown o nel prompt mandato a un modello.

La cronologia visibile della chat può conservare la label già mostrata: è UI,
non contesto strutturato. Una risposta strutturata del topic `role` espone al
modello il proprio `value` canonico e non il campo `label` localizzato.

## 3. Persistenza e prompt

Una nuova scelta del wizard:

1. salva `target_role_category_id` nel draft strutturato;
2. salva `target_specialty` dopo il passo di dettaglio;
3. non valorizza né modifica `target_role`;
4. consegna categoria e specialty al profilo YAML e al contesto modello;
5. non rende completo il requisito `target_role`, che resta soddisfatto solo da
   testo libero inserito dall'utente.

Il writer del profilo accetta i due campi nuovi soltanto con ID previsti da
questo contratto. `target_specialty` senza una nuova categoria canonica viene
ignorato: è il caso di uno stato guidato legacy, nel quale prima non veniva
persistito nel profilo. Un valore esplicitamente presente ma non ammesso fa
fallire la scrittura prima di modificare il file.

Il contesto onboarding machine-readable passa da schema 2 a schema 3.

## 4. Compatibilità forward-only

I profili e i draft esistenti possono contenere in `target_role` valori come
`Software Engineering`, `Data / AI` o testo identico scritto davvero
dall'utente. Non esiste un marcatore di provenienza che permetta di distinguerli.

Per decisione di prodotto:

- nessun valore legacy viene migrato, normalizzato o cancellato;
- `target_role` esistente resta invariato finché l'utente non lo modifica;
- il wizard può riconoscere in sola lettura i sette valori che generava prima,
  esclusivamente per riprendere il corretto menu specialty;
- tale riconoscimento non scrive l'ID nuovo e non cambia il profilo;
- soltanto una scelta effettuata dopo questo contratto crea
  `target_role_category_id`.

## 5. Vettori obbligatori

1. UI italiana, scelta `software` → label italiana a schermo; draft, profilo e
   prompt contengono `target_role_category_id=software`, mai la label.
2. Scelta `software` + `fullstack` → profilo e prompt contengono entrambi gli ID;
   `target_role` non viene creato dal wizard.
3. Profilo legacy `target_role: Software Engineering` → nessuna modifica e
   nessun `target_role_category_id` inventato.
4. Draft legacy fermo allo specialty con `target_role=Data / AI` → mostra ancora
   le specialty data senza riscrivere il draft.
5. Risposta strutturata `topic=role`, `value=design`, label tedesca → il contesto
   modello contiene `design` e non la label.
6. Categoria o coppia categoria/specialty non ammessa → nessuna scrittura del
   profilo.

Cambiare nomi dei campi, ID, coppie ammesse, trattamento di `target_role` o
politica legacy richiede una nuova versione esplicita prima del codice.
