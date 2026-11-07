---
name: scout-coverage
description: "Cerca i portali nazionali core delle lingue del profilo PRIMA di qualunque fonte minore, e sappi quanto del piano è fatto. `next` indica il portale, il paese da registrare e il tipo di query da fare; un portale è coperto con 3 passate e 3 query diverse, e «esausto» richiede i portali core coperti. Lancia `next` all'inizio di ogni ricerca."
allowed-tools: Bash(python3 /app/shared/skills/scout_coverage.py *) Bash(python3 /app/shared/skills/scout_pass_log.py *) Bash(python3 /app/shared/skills/profile_version.py *) Bash(python3 /app/shared/skills/linkedin_access.py *)
---

# scout-coverage — dove cercare prima, e quanto è fatto

Cerca PRIMA dove stanno i mercati del profilo e sappi quanto ne è fatto. Una prova reale ha interrogato 105 fonti una volta ciascuna e non ha mai aperto i portali nazionali principali della lingua dell'utente: «esausto» è stato dichiarato col mercato di casa intatto. Questa skill dà l'elenco (portali nazionali di ogni lingua che il profilo parla, prima i core, poi quelli English-first e remote) e il contatore sul tuo registro delle passate.

## 1. Chiedi cosa viene dopo, a ogni ricerca

`next` stampa una riga JSON: il portale (`source`, `country`, `tier`), il TIPO di query (`query_kind`: `broad` = una query LARGA, sempre la prima: la famiglia del ruolo o una parola d'ingresso da sola (in `broad_terms`), senza titolo completo e senza luogo nelle parole chiave; mantieni il filtro geografico del profilo, `role_language` = il titolo nella lingua del portale, `role` = il titolo in inglese, `synonym` = un titolo vicino, `level` = il titolo con una parola di livello della lingua, elencate in `level_terms`, `city` = il titolo con un luogo, elencati in `cities`), cosa hai (`have`) contro cosa serve (`need`) e la riga `log` da usare dopo. Cerca esattamente quello, poi registra la passata con lo stesso `--query-kind`. `plan_done: true` vuol dire piano finito: passa alle altre fonti.

`next` dice anche, con il tuo id, se il profilo è cambiato da quando hai costruito i cerchi: `"profile": {"changed": true, "groups": [...]}`. Rileggi il profilo, rifai i cerchi dei gruppi cambiati, tieni le tue posizioni e le tue passate, poi `profile_version.py ack`.

```bash
# the next thing to search: portal, country to log, kind of query, and the line to log it with
python3 /app/shared/skills/scout_coverage.py next

# con il tuo id: dice anche se il profilo è cambiato da quando hai costruito i cerchi (allora rileggilo, rifai i cerchi e fai ack)
python3 /app/shared/skills/scout_coverage.py next --agent $MY_ID
python3 /app/shared/skills/profile_version.py ack --agent $MY_ID

# the whole plan for this profile (once), and how much of it is done (any time)
python3 /app/shared/skills/scout_coverage.py plan
python3 /app/shared/skills/scout_coverage.py status

# after the search: the same portal, country and kind that `next` named
python3 /app/shared/skills/scout_pass_log.py pass --source platsbanken --country se --query-kind role_language --query "<the query you ran>" --returned 12
# a portal that answers 403 / a login wall / a challenge (closed) or 410 (gone): ONE pass closes it
python3 /app/shared/skills/scout_pass_log.py pass --source platsbanken --country se --returned 0 --status closed
```

## Regole

- La PRIMA domanda su un portale è sempre `broad`: una parola di `broad_terms` o la famiglia del ruolo, DA SOLA. Un portale che mette le parole in AND risponde 0 a «junior project coordinator» + una città e centinaia a «praktik». Leggi TUTTI i risultati, ogni pagina, e filtrali tu contro il profilo. Un portale è coperto solo con una passata `broad`, oltre alle 3 query diverse e a quella nella sua lingua.
- Platsbanken (Svezia) ha un'API pubblica, senza chiave: `python3 /app/shared/skills/platsbanken_search.py --q "praktik" --city stockholm --no-experience --query-kind broad --log`. Le bacheche aziendali di un paese: `python3 /app/shared/skills/scout_coverage.py boards --country se`.
- Per gli altri paesi `next` (e `plan`) dà, quando la tabella li ha, `api` e `hint`: l'indirizzo pubblico che risponde in JSON o open data senza chiave (Germania: Arbeitnow) e l'indirizzo di ricerca di ogni portale. Chiedi QUELLO, non la home page, con una parola LARGA, e leggi tutte le pagine. Le bacheche aziendali di FR, DE, ES, PT, NL, BE, CH e AT: `python3 /app/shared/skills/scout_coverage.py boards --country <cc>`.
- Una bacheca aziendale (Greenhouse, Lever, Teamtailor) si legge INTERA con `python3 /app/shared/skills/ats_board_search.py --provider greenhouse --board truecaller --country se --log --query-kind broad`: riconosce il paese in ogni forma di luogo, dà la seniority letta dal titolo e dice quanti annunci ha tolto ogni motivo (`counts`, `dropped`). Leggi `dropped` prima di dire che una bacheca è vuota; `--drop-seniority senior,lead` e `--title-any` li scegli tu, non toglie niente se non glielo chiedi.
- Prima i core, poi i minori: nessuna fonte minore finché `next` nomina un portale core.
- Un portale è COPERTO con 3 passate e 3 query DIVERSE (una nella lingua del portale se non è l'inglese). La stessa query tre volte conta una volta: cambia il tipo, non le parole.
- Un portale che risponde 403, 410, un muro di login o una challenge è CHIUSO con UNA passata registrata `--status closed` (o `gone` per il 410): dillo e passa oltre, non insistere.
- `exhausted` (`scout_exhaustion.py check`) richiede OGNI portale del piano coperto nelle ultime 24 ore (core e minori, di ogni paese) oltre a fonti, query e minuti: `uncovered` dice dove devi ancora andare (`core_missing` ne è la parte core). Una fonte secca mentre altre non sono coperte non è un mercato secco: continua con `next`. Un portale che ha risposto con un errore è `blocked` (`--status blocked`): riposa circa 3 ore e viene richiesto di nuovo, e non è né coperto né secco.
- Del profilo non si scrive mai niente: il registro ha slug, codici paese, tipi e conteggi.

## Scope geografico ed esiti espliciti

Luoghi obiettivo e preferenze del profilo determinano l'area. `broad` allarga solo le parole del ruolo: mantieni il filtro geografico su tutte le pagine. Paese del portale e città suggerite non autorizzano trasferimenti. Per LinkedIn usa questo comando (QUERY è la famiglia del ruolo; COUNTRY e KIND vengono da `next`):

```bash
python3 /app/shared/skills/linkedin_access.py search --profile "$JHT_HOME/profile/candidate_profile.yml" --keywords "$QUERY" --log --country "$COUNTRY" --query-kind "$KIND" --agent "$MY_ID" --posted-within-days 7
```

Il comando registra l'esito effettivo: non registrarlo una seconda volta a mano. Uscita 4 e ultima riga JSON `search_outcome` indicano errore di fonte, profilo o mismatch geografico: segui `status` (`blocked`, `closed`, `gone`) e passa a una fonte compatibile, conservando i candidati già restituiti. Uscita 3 mantiene la regola rate limit/cooldown. Solo una lista vuota riuscita è `empty`. `scope_match` confronta nomi dichiarati, non è un geocoder: `unmatched` o `unknown` NON provano esclusione. Verifica luogo completo/JD contro il profilo, mantenendo tutti i gate; non inserire un'offerta provata fuori area. `scout_search_geo_mismatch` significa che nessun nome restituito corrisponde: diagnostica l'area della fonte o cambia fonte; non dichiarare secco il mercato locale. Niente ID geografici inventati o paese dedotto dalla lingua parlata. Nell'harness nativo senza shell conserva l'area del profilo nella query nativa e verifica le prove della fonte; non eseguire sul sistema host comandi del container.
