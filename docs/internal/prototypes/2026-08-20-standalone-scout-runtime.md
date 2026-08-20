# Standalone API Scout runtime — stato e roadmap

**Data:** 2026-08-20
**Stato:** ecosistema isolato implementato; canary OpenAI eseguito e reader adattivo aggiunto

## Obiettivo bloccato

Un comando avvia uno Scout fuori dal container e indipendente dal runtime JHT.
Lo Scout riceve una chiave API soltanto tramite la variabile d'ambiente del
provider, legge un profilo candidato esplicito, controlla se esistono colleghi
attivi, si coordina tramite un database proprio, cerca annunci sul web e inserisce
ogni risultato verificato nel proprio SQLite locale.

Email, tmux, launcher, Bridge, Sentinel, credential vault e `jobs.db` non fanno
parte di questo ecosistema.

## Implementato

1. **Profilo standalone** — YAML/JSON con ruoli, località, modalità di lavoro,
   skill, esperienza, lingue, work authorization e ampiezza della ricerca.
2. **Coordinamento SQLite** — lease agente, heartbeat, rilevazione peer, claim
   atomica di una corsia `ruolo:località:modalità`, scadenza dei peer morti e
   storico degli eventi di coordinamento.
3. **Ricerca live** — web search nativa Anthropic/OpenAI, abilitata soltanto con
   `--live`, profili espliciti, capability dichiarata e costo web-search
   dichiarato.
4. **Evidence pipeline adattiva** — ogni URL passa da un client HTTPS che
   ammette solo indirizzi globali IPv4/IPv6 e lega il socket TLS all'esatto
   risultato DNS validato, eliminando il secondo lookup vulnerabile a rebinding.
   Redirect e subrequest sono ricontrollati; timeout, numero richieste e byte
   trasferiti sono bounded. Il reader prova HTTP con user-agent realistici e,
   se la pagina è bloccata o client-only, scala a Chrome headless mantenendo la
   sandbox. Chrome non risolve né apre connessioni proprie: HTTP passa dal client
   protetto, mentre service worker, WebSocket e QUIC sono bloccati. Usa
   Schema.org `JobPosting` quando disponibile;
   altrimenti restituisce testo visibile bounded dal quale il modello può fare
   soltanto estrazione grounded, verificata prima della persistenza.
5. **SQLite dedicato** — `positions(status='new')`, provenance del run e agente,
   eventi append-only e dedup pre-insert a tre livelli: URL normalizzato;
   azienda+titolo+location; azienda+titolo simile+location.
6. **Guardrail** — step, tool call, web search, byte, timeout, token e budget USD.
   Il consumo di una risposta già eseguita entra nel ledger prima dei check
   post-risposta. Chiavi, prompt, profilo, contenuto annunci e messaggi raw del
   provider non entrano nell'audit JSONL; i riepiloghi CLI omettono anche i path
   assoluti di database e audit.
7. **Percorso offline E2E** — fixture sintetiche e mock provider esercitano
   coordinamento, worker, dedup e persistenza senza rete o credenziali.

## Confini intenzionali

- Il core `ScoutApiWorker` resta proposal-only. La scrittura è nel wrapper
  standalone e punta esclusivamente al DB sotto il workspace dato al comando.
- Kimi resta disponibile per il catalogo iniettato, ma non per il web standalone:
  l'adapter compatibile non offre un tool web provider-native verificato.
- Il reader non usa sessioni browser personali o login: Chrome è isolato e
  headless. Se la sandbox non parte, il reader fallisce chiuso senza riprovare
  con flag più deboli. Una fonte che richiede autenticazione resta non utilizzabile, ma non
  interrompe il run: lo Scout cambia URL, fonte o query finché i limiti lo
  consentono.
- L'agente esegue oggi un ciclo finito per invocazione. È una scelta di controllo
  della spesa prima del primo run reale, non il lifecycle definitivo.
- L'inbox email non è collegata; resta un futuro `ScoutLeadSource` parallelo al web.

## Prossime tranche, in ordine

1. **Qualità fonti** — misurare successi per hostname/fetch method e aggiungere
   adapter ATS source-specific dove riducono davvero browser e token.
2. **Lifecycle continuo** — loop multi-ciclo con cooldown, rotazione corsie,
   rinegoziazione quando un peer entra durante un run e stop esplicito su
   esaurimento. Il budget deve essere globale al processo, non resettato per
   ciclo.
3. **Email adapter** — ingest read-only degli alert, stessa evidence pipeline URL e
   stessa pipeline dedup/persistenza.

L'integrazione nel `jobs.db` di produzione non è una tranche di questa roadmap:
richiederebbe un adapter separato e un'autorizzazione esplicita.
