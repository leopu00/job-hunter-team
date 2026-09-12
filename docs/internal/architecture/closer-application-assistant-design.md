# `[JHT-CLOSER]` — CLOSER, l'assistente alle candidature

> Stato: **design approvato dall'operatore il 2026-09-12**, nessuna riga di
> implementazione scritta. Vault padre: [`2026-08-03-local-vault-design.md`](2026-08-03-local-vault-design.md).
> Threat model: [`SECURITY.md`](../../../SECURITY.md).
> Misure di questo documento: prese il 2026-09-12 su una VPS viva e sull'albero
> di `master`, non lette da un altro documento.

## 1. Il buco nel funnel

Il funnel delle posizioni è `new → checked → scored → writing → review → ready
→ applied → response` (`shared/skills/_db.py:194`). Tutti i salti hanno un
ruolo che li esegue, tranne uno: **`ready → applied` lo fa l'umano a mano**,
un click per candidatura. È deliberato (`docs/about/ROADMAP.md`: *"the human
clicks send"*, `applied=0` by-design nei postmortem VPS del 21/05) ed è anche
il punto in cui il lavoro del team si ferma: 105 CV `ready` e 0 inviati su
`vps1`, 56 e 0 su un'altra.

Il CLOSER copre quel salto, **sotto autorizzazione esplicita dell'utente**.

## 2. Nome, identificatore, etichetta

Tre cose distinte, e vanno tenute distinte:

| Livello | Valore | Vincolo |
| --- | --- | --- |
| `role_id` | `closer` | **un solo token minuscolo**: entra nel `case` di `.launcher/start-agent.sh`, nel glob di `.launcher/agent-watchdog.sh:303` e in `applied_via` |
| Sessione tmux | `CLOSER-N` | `team_roster.py:186` compone `ROLE.upper() + "-" + N`; un id con trattino produrrebbe `APPLICATION-ASSISTANT-2`, che il glob del watchdog non riconosce — nessuno curerebbe l'agente quando si blocca |
| Etichetta utente | «Assistente alle candidature» | tradotta nelle 7 lingue, vive in UI/onboarding/docs |

Il nome proprio **non si traduce**, come per tutti gli altri ruoli
(`agents/scrittore/scrittore.de.md` dice *"Du bist ein **Scrittore**"*). Metà
del roster è già inglese (SCOUT, SCORER, MENTOR), quindi `CLOSER` non introduce
un registro nuovo. Intestazione del prompt, secondo la convenzione esistente
«nome — descrizione»:

```
# 📮 CLOSER — Application Assistant (user-authorised)
```

| Lingua | Etichetta |
| --- | --- |
| it | Assistente alle candidature |
| en | Application Assistant |
| de | Bewerbungsassistent |
| es | Asistente de candidaturas |
| fr | Assistant de candidature |
| pt | Assistente de candidaturas |
| hu | Jelentkezési asszisztens |

⚠️ Nei messaggi fra agenti e nei log si scrive **sempre `CLOSER`**, mai
«l'assistente»: il ruolo `ASSISTENTE` esiste già ed è quello che parla con
l'utente. L'etichetta lunga sta solo dove la legge l'utente.

Scartati, con la ragione: `POSTINO`/`POSTMAN`/`COURIER` nominano il trasporto,
non l'esecuzione (e `Postman` è il client API più diffuso al mondo: in un repo
pubblico ogni ricerca atterra nel posto sbagliato) · `INVIATO`/`ENVOY` sono
ingreppabili (28 e 21 occorrenze come parole comuni nell'albero) ·
`PROCURATORE` è un falso amico cattivo (in francese *procureur* = pubblico
ministero) · `AGENTE` non distingue niente. Alternativa italiana equivalente,
se il nome proprio dovrà cambiare: `DELEGATO` («agisce per delega»), che
viaggia in tutte e 7 le lingue con lo stesso sottotitolo.

## 3. Cosa esiste già (misurato 2026-09-12)

Non si parte da zero: l'idraulica è quasi tutta posata.

| Pezzo | Stato verificato |
| --- | --- |
| Browser | **Playwright + Chromium 1228** nell'immagine, `PLAYWRIGHT_BROWSERS_PATH=/opt/playwright`, eseguibile `/opt/playwright/chromium-1228/chrome-linux64/chrome`, wrapper `/usr/local/bin/playwright` |
| Cascata di accesso | `shared/skills/web_scrape_robust.py` — L1 `requests`, L2 Playwright stealth, L3 `launch_persistent_context` |
| **Sessione loggata** | **il gancio c'è già**: L3 usa `$JHT_HOME/.cache/playwright/default` (`web_scrape_robust.py:358`) e `linkedin_check.py` usa `LINKEDIN_PROFILE_PATH`. Mai popolato: sulla VPS controllata nessun profilo su disco |
| LinkedIn oggi | `linkedin_access.py` = endpoint **guest**, zero login, sola lettura annunci (è dello Scout, e resta suo) |
| Vault | `shared/credentials/` — AES autenticato + PBKDF2, file `0600`, dir `0700`, passphrase da `JHT_CREDENTIALS_KEY` o OS keyring. ⚠️ `types.ts` ammette **solo** `api_key`/`oauth` di provider LLM: **nessun tipo per un login di sito** |
| Design del broker | già scritto in [`2026-08-03-local-vault-design.md`](2026-08-03-local-vault-design.md) (envelope encryption + broker runtime) |
| Ritorno del dato | `applied_via` esiste e dice **chi** ha inviato; il backflow cloud→box è `[APPLIED-STATE-NEVER-COMES-HOME]` (#186) |
| Ricevute / OTP | `shared/skills/email_monitor.py` (IMAP) legge già una casella: serve per la mail di conferma **e** per i codici di verifica del login |
| CV in PDF | `shared/skills/pdf_gen.py`, già prodotto dallo SCRITTORE |

## 4. Modello credenziali — decisione

**La sessione, non la password.** L'utente fa **un** login, una volta, nel
browser che JHT apre per lui; sul box resta il *persistent context* (L3, già
cablato). Gli agenti non hanno mai la password: hanno una porta già aperta.

Il vault serve a **una** cosa precisa: rinnovare la sessione quando scade,
senza svegliare l'utente. Chi non vuole dare la password resta sulla sessione
pura e riceve una notifica «ri-fai il login» quando serve.

Scartato — **profili LinkedIn creati dagli agenti**, e non per pulizia: la
candidatura via Easy Apply parte dall'account **che è loggato**, quindi
arriverebbe al recruiter firmata da un profilo fake e non dall'utente. Non è
poco elegante: è inutile. (In più, a scalare, un bacino di account falsi
tracciabili al prodotto.)

Scartato — **browser-as-a-service** (Browserbase, Steel e simili): i dati
personali dell'utente uscirebbero dal suo box, contro il modello «gira a casa
tua», con un costo per-sessione per utente.

### 4.1 PORTINAIO — il broker, che è codice e non un agente

Il vincolo «non fare cazzate con le credenziali» **non è una proprietà di un
prompt**: è una proprietà di un processo separato. Il CLOSER chiede «apri
LinkedIn»; il PORTINAIO digita nel campo e restituisce `session_ok`. La
password non entra mai nel contesto dell'LLM, quindi non finisce in un log, in
un `tmux capture-pane`, in un messaggio fra agenti.

Superficie esposta, volutamente minuscola:

```
fill_login(domain) -> {"session": "ok" | "needs_user", "reason": ...}
session_status(domain) -> {"valid": bool, "expires_hint": ...}
```

Nessuna primitiva che *restituisca* un segreto. Da costruire:

1. terzo tipo `site_login` in `shared/credentials/types.ts` (oggi solo
   `api_key`/`oauth`), con `domain`, `username`, `password`, `totp_secret?`;
2. `jht creds set linkedin` nel wizard, che assorbe anche il caso già noto
   della password email in chiaro in `~/.jht/credentials/email_monitor.json`;
3. il broker come processo a sé, invocato per dominio.

⚠️ `~/.jht` appartiene al container (uid 1001): il `chmod 0700` dall'host
fallisce con `EPERM` e non è una precondizione (vedi `storage.ts:ensureDir`).

### 4.2 Il login vero, in pratica

- **Box locale / gioco**: Chromium headful, l'utente digita, fine.
- **VPS**: `xvfb` + noVNC su `localhost`, esposto per il tempo del login via
  tunnel SSH dalla dashboard, poi spento.
- ❌ **Mai** copiare i cookie dal Mac alla VPS: sessione su IP e UA diversi =
  challenge immediata, e si brucia il profilo.
- Un persistent context **per dominio** (`.cache/playwright/linkedin`,
  `…/greenhouse`, …), non uno globale: se una sessione si brucia, si brucia una
  sola.

## 5. Componenti da costruire

| # | Componente | Cosa fa |
| --- | --- | --- |
| 1 | `ats_detect.py` | riconosce la piattaforma da URL/DOM: **Workday · Greenhouse · Lever · Ashby · SmartRecruiters · SuccessFactors · Taleo · iCIMS · Recruitee** + **LinkedIn Easy Apply**. Non serve un agente generalista: servono ~9 ricette |
| 2 | `apply_flow.py` | macchina a stati `detect → fill → upload CV → screening questions → review → submit`, con **checkpoint per step**: se cade, riprende dove era |
| 3 | broker PORTINAIO | §4.1 |
| 4 | `apply_receipt.py` | **prova dell'invio**: screenshot finale + URL/testo di conferma + match della mail di conferma via `email_monitor`. **Senza ricevuta, `applied` non si scrive** |
| 5 | `human_gate` | captcha, 2FA, campo ignoto, upload rifiutato → stato `blocked_human` + `jht-notify-user`. Mai tentativi ciechi |
| 6 | rate policy | tetto giornaliero **per dominio**, orari umani, jitter fra invii |
| 7 | `application_answers` | il dato che oggi manca (§6) |

## 6. Il contesto che manca

Il profilo candidato copre già contatti (`candidate.contacts`: email, phone,
linkedin, github), `work_authorization` e `salary_target`. Manca ciò che
chiedono i form: **preavviso, disponibilità, relocation, necessità di
sponsorship, "come ci hai conosciuto", EEO/disability, domande custom**.

Nuova sezione `application_answers` nel profilo, compilata dal wizard. Le
risposte aperte («perché noi?») le scrive lo **SCRITTORE**, non il CLOSER: chi
consegna non redige.

**Invariante non negoziabile: il CLOSER non inventa un dato.** Campo
obbligatorio che non ha → si ferma e chiede. È il difetto che ucciderebbe la
feature: un'allucinazione qui non è un bug, è una bugia scritta a un recruiter
con il nome dell'utente.

## 7. Stati e autorizzazione

```
ready → [autorizzazione utente] → sending → applied | blocked_human
```

`applied_via` distingue `user_manual` da `agent_closer`, e il backflow #186
porta già a casa dal cloud l'azione dell'utente.

Tre livelli di autorizzazione, si **parte dal primo**:

| Livello | Cosa autorizza l'utente | Quando |
| --- | --- | --- |
| 🅰️ **dry-run** | il CLOSER compila **tutto** e si ferma sul bottone; l'utente vede il form pieno e clicca | **partenza decisa** — misura la percentuale di form compilati bene *prima* di concedere il potere di inviare |
| 🅱️ per-posizione | autorizza in blocco le `ready` che vuole, il CLOSER invia | quando 🅰️ è affidabile |
| 🅲 standing order | «tutto ciò che è `ready` con score ≥ 80, max 5 al giorno» | solo su richiesta esplicita |

## 8. Ordine di consegna

| Fase | Cosa | Perché in questa posizione |
| --- | --- | --- |
| 1 | `site_login` nel vault + PORTINAIO + `jht login <dominio>` headful locale | senza sessione non esiste niente |
| 2 | `ats_detect` + **una** ricetta: **Greenhouse o Lever** | form più regolari: si collauda la macchina senza combattere Workday né i ToS di LinkedIn |
| 3 | CLOSER + `apply_receipt` + `blocked_human`, in 🅰️ dry-run | si misura prima di dare potere |
| 4 | gate 🅱️ + rate policy → primo invio vero | |
| 5 | LinkedIn Easy Apply + Workday | i due più ostici, con la macchina già collaudata |
| 6 | layer MCP di accessibilità (albero a11y invece di HTML/screenshot) + noVNC per il login su VPS | miglioramenti, non prerequisiti |

## 9. Rischi e non-goal

- **ToS.** L'automazione dell'invio è contro i termini di LinkedIn e il rischio
  è la restrizione dell'account **dell'utente**. Si governa col ritmo (poche
  candidature al giorno, orari umani, mai burst) e con un consenso esplicito in
  fase di attivazione, non con lo stealth. I career-site/ATS non hanno lo
  stesso vincolo — ed è la ragione in più per cui la fase 2 parte da Greenhouse
  e non da LinkedIn.
- **Nessun browser nuovo.** Chromium+Playwright è l'unica cosa che esiste su
  Linux dentro Docker; gli «agent browser» desktop (es. ego lite, macOS-only,
  GUI-dipendente) restano eventuali utensili da banco lato HQ, mai runtime del
  prodotto.
- **Niente stealth** finché l'anti-bot non morde: il vantaggio qui è essere
  loggati come utente vero.
- ⚠️ **`docs/about/ROADMAP.md` va emendato**: la riga *"No auto-apply spam: […]
  the human clicks send"* descrive un invariante che 🅱️ cambia. L'intento
  regge (nessuno spam, gate umano, qualità sopra volume), la lettera no. È
  framing pubblico: si riscrive **con l'ok dell'operatore**, non di iniziativa.

## 10. Punti aperti

- Chi spawna il CLOSER: il CAPITANO (come gli altri worker, su coda
  `authorised`) o l'ASSISTENTE alla conferma dell'utente.
- `closer` va in `WORKER_ROLES` (spawn multiplo `CLOSER-1..N`) o resta singolo:
  dipende dalla rate policy — più istanze non servono se il tetto è di poche
  candidature al giorno.
- Modello: il form-filling non richiede Opus; da misurare in fase 3.
