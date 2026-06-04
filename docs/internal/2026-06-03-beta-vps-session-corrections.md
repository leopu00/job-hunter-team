# Correzioni — sessione beta tester VPS (2026-06-03)

> Findings raccolti durante il primo avvio del team su VPS Hetzner di un beta
> tester reale (host/IP/profilo/località anonimizzati per privacy).
> Provider Codex (ChatGPT OAuth), team English-first, working hours configurate.
> Doc vivo: spuntare man mano che le correzioni vengono applicate + linkare i commit.

Legenda stato: ✅ già fixato in questa sessione · 🔲 da fare · 🟡 fix temporaneo (hot-patch live, manca persistenza/strutturale)

---

## ✅ Già corretti in questa sessione

### 1. Welcome agenti hardcoded in italiano
- **Dove**: `.launcher/start-agent.sh` → `_welcome_kickoff` (body assistente/capitano/mentor ~righe 912-938) + riga 878 ("UN SOLO messaggio, italiano").
- **Problema**: `JHT_LANG=en` ignorato per i welcome → i bot si presentavano in IT (bloccante per beta tester EN).
- **Fix applicato**: body sostituiti con le versioni EN (stesse stringhe di `shared/locales/en.json`) + istruzione "in inglese, invia ESATTAMENTE com'è". Commit `8e42e659` + hot-patch `docker cp` nel container live + respawn → welcome riconsegnato in EN.
- **Follow-up 🔲**: i18n-izzare via `t welcome.<role>` (vedi #7) — oggi `it.json` ha le chiavi `welcome.*` vuote e `JHT_LANG` allo spawn è inaffidabile, quindi per ora EN hardcoded.

### 2. Build Vercel produzione rotto (`Module not found: zod`)
- **Dove**: `web/vercel.json` (la Root Directory del progetto Vercel è `web/`, quindi usa QUESTO file, non il `vercel.json` a root).
- **Problema**: `web/` importa `shared/config/schema.ts` che dipende da `zod`; Vercel installava solo le deps di `web/` → turbopack non risolveva `zod` da `shared/node_modules` → deploy production fallito in silenzio → sito fermo (sembrava "non aggiornato").
- **Fix applicato**: `installCommand: "npm install && cd ../shared && npm install"`. Deploy `34bce54d` success.
- **Nota diagnostica**: i deploy Vercel falliti NON aggiornano il sito (resta l'ultimo OK). Diagnosi via `gh api repos/.../deployments` + `/statuses` + `npx vercel inspect <dpl> --logs`.

### 3. Build job Release rotto (stesso `zod`)
- **Dove**: `.github/workflows/release.yml` (job `release`, step Build web).
- **Problema**: faceva `npm ci` solo in `web/` → stesso fallimento zod del punto #2 → Release v0.1.18 fallita al primo tag (nessun asset pubblicato).
- **Fix applicato**: aggiunto step `npm ci` in `shared/` prima del build (allineato a CI "Build Web"). Release v0.1.18 ripubblicata con DMG/exe/AppImage.

---

## 🔲 Da correggere (strutturali)

### 4. Capitano: cap fisso "Max instances" per categoria → serve autonomia di scaling
- **Dove**: `agents/capitano/capitano.md` (sorgente) + runtime `/jht_home/agents/capitano/AGENTS.md`, tabella "👥 Team" colonna **Max instances**.
- **Stato attuale**: Scout=2, Analista=2, Scorer=1, Scrittore=3, Critico/Sentinella/Dottore/Assistente=1.
- **Problema**: il Capitano NON può spawnare oltre il cap (es. Scout-3 impossibile). L'ordine utente "spawna Scout-3" non è eseguibile.
- **Correzione richiesta (utente)**: il Capitano deve essere **libero di decidere quanti agenti per categoria** ritiene giusti, **limitato dal budget** (proj 5h + weekly) e dalla profondità delle code, NON da un numero fisso. Sostituire i cap fissi con: autonomia bounded-by-budget (già esiste la logica C-07 throttle + C-09 weekly-awareness + pipeline-triage). Eventualmente tenere solo un tetto di sicurezza alto (es. anti-runaway) invece di 1-2.
- **Attenzione**: più agenti paralleli = finestra 5h bruciata più in fretta → la guardia deve restare il budget, non il count.

### 5. tg-bridge non parte al boot se config vuota a pid1-time
- **Dove**: `cli/src/commands/pid1.js` (avvio bridge) + flusso wizard.
- **Problema**: a boot (pid1) il `jht.config.json` era vuoto → log `[pid1] tg-bridge: nessun bot in jht.config.json, skip`. Il wizard scrive bot+provider DOPO (mtime config successiva), ma né tg-bridge né pacing/sentinel-bridge vengono rilanciati → "scrivo ai bot e non risponde nessuno".
- **Fix in sessione 🟡**: avviati a mano i 3 tg-bridge + pacing/sentinel ripartiti. Strutturale: pid1/wizard deve **(re)avviare i bridge dopo che il wizard scrive il config** (watch sul config o hook fine-wizard).

### 6. Codex auth.json condiviso tra i 3+ agenti → rotazione refresh token
- **Dove**: `/jht_home/.codex/auth.json` unico per tutti gli agenti Codex.
- **Problema**: più istanze Codex sullo stesso refresh token → la prima che fa refresh ruota il token e invalida le altre → "Your session has ended. Please log in again." su tutti. (O login dello stesso account altrove.) Causa probabile del crash auth osservato.
- **Fix**: valutare auth per-agente o gestione centralizzata del refresh (un solo "owner" del refresh, gli altri leggono il token caricato). Nodo di prodotto.

### 7. Welcome / kickoff non i18n (debito da #1)
- **Dove**: `.launcher/start-agent.sh` `_welcome_kickoff` + `shared/locales/*.json`.
- **Problema**: il testo welcome dovrebbe venire da `t welcome.<role>` (come fa già `welcome-send.sh`), ma `_welcome_kickoff` lo hardcoda. Inoltre le chiavi `welcome.*` esistono in `en.json` ma NON in `it.json` (vuote) → i18n incompleta.
- **Fix**: usare `t welcome.<role>` nel kickoff (sourcing i18n + JHT_LANG affidabile allo spawn) e popolare i locali mancanti. Anche le istruzioni di protocollo del kickoff sono hardcoded IT.

### 8. Sentinel g-spot band non allineata al target pacing
- **Dove**: `.launcher/sentinel-bridge.py` (g_spot 80-105%) vs `.launcher/pacing-bridge.py` (target schedule+ratio ~40%).
- **Problema**: il pacing punta al 40.49%/finestra (weekly-aware) ma il sentinel proietta/throttla verso la banda 80-105% → più aggressivo del dovuto (visto picco proj 137.8% → ATTENZIONE precoce). Design doc `2026-05-25-work-hours-design.md` step 7 ("Sentinella aggiorna projection per allinearsi al target window, non più 92% fisso") sembra incompleto.
- **Fix**: allineare la banda/proiezione del sentinel al `current_window_target_pct` del pacing.

### 9. `jht wh simulate` fallisce sull'host (`spawn docker ENOENT`)
- **Dove**: wrapper host `jht` / sottocomando `working-hours simulate`.
- **Problema**: `jht wh simulate` esce con `spawn docker ENOENT` mentre altri sottocomandi `jht` funzionano → path/contesto docker diverso per `simulate`.
- **Fix**: allineare il lancio di `simulate` al resto del wrapper (richiede container running).

### 10. work_hours_target.py standalone fuorviante
- **Dove**: `shared/skills/work_hours_target.py` (`__main__`).
- **Problema**: lanciato a mano non interroga `provider_capacity` → `window_cap_pct_of_weekly=null` → stampa fallback `mode=unlimited weekly-legacy` / target 92%, che NON è quello che il daemon applica (il pacing-bridge passa il ratio → 40.49%). Causa diagnosi errata ("team al 92%"). Source of truth = `/jht_home/logs/pacing-bridge-state.json` (`current_window_target_pct`, `target_source`).
- **Fix**: nello standalone `__main__`, fetchare il ratio da `provider_capacity` (come il daemon) così l'output riflette il comportamento reale.

### 11. SKILL.md con YAML invalido → skill skippate al boot
- **Dove**: `pipeline-triage/SKILL.md` (Capitano, line 2 col 514), `spawn-agent/SKILL.md` (Capitano, line 2 col 280), `profile-yaml/SKILL.md` (Assistente, line 2 col 337).
- **Problema**: warning `invalid YAML: mapping values are not allowed in this context` → skill non caricate. Già notato nell'incident 2026-05-21, ancora presente.
- **Fix**: correggere il frontmatter YAML (probabile `:` non quotato nel description).

### 12. DOTTORE: REPL Codex crasha → fallback bash con leak istruzione
- **Dove**: launcher/watchdog del Dottore (one-shot).
- **Problema**: visto il REPL codex morto → shell bash, con l'istruzione di kickoff finita in bash (`-bash: Leggi: command not found`). Robustezza spawn one-shot.
- **Fix**: verificare PATH/spawn del Dottore + retry se il REPL non aggancia.

### 13. JHT_USER_TZ default Etc/UTC (non quello dell'utente)
- **Dove**: `host.env` / onboarding.
- **Problema**: il TZ del team era `Etc/UTC`; le working hours "8-20" rischiavano di valere in UTC. Design doc prevede TZ IANA da onboarding browser → `schedule.json.timezone`. Sul VPS era UTC e ho dovuto passare `--tz Europe/Rome` a mano.
- **Fix**: propagare il TZ utente dall'onboarding fino a host.env / working_hours di default.

### 14. ✅ `sentinel-bridge.py`: provider "codex" cade in `unsupported` → Sentinella cieca sui token
- **Dove**: `.launcher/sentinel-bridge.py` (dispatch provider → fetch).
- **Problema**: `if provider == "openai":` per chiamare `fetch_codex_rollout()`, ma il wizard scrive `active_provider: "codex"` → nessun ramo matcha → `unsupported:codex`. La Sentinella **non leggeva il consumo token Codex** per i primi ~8 min dopo l'avvio dei bridge → pacing cieco al boot. Il codice Codex (`fetch_codex_rollout`) c'era già: puro mismatch config↔dispatch.
- **Fix applicato (dev3)**: `if provider in ("openai", "codex"):`. Commit `6dbe8e23` (cherry-pickato in master) + hot-patch container → verificato `OK usage SOTTOUTILIZZO`.

### 15. 🔲 Calibrazione ratio finestra→weekly INCOERENTE (3% vs 14.7% vs 19% misurato)
- **Dove**: `capitano.md` (regola C-09) + seed `window_cap_pct_of_weekly` (`provider_capacity`) + `window-ratio-meter`.
- **Problema**: tre valori per la stessa grandezza: C-09 mental model = **3%**; seed bridge = **14.7%**; **misurato su questo run (dev3) = 19%** (Δprimary 0→79% ⇒ Δweekly 0→15%); meter ~25% low-confidence. Il mental model C-09 sottostima ~6× → se il Capitano si fida del 3% sotto-protegge il weekly (rischio HALT-WEEKLY).
- **Fix**: una sola fonte-di-verità per il ratio (~17-19% misurato), propagata a C-09 + seed + meter. Mitigante: `residual_to_reset` auto-corregge dal `weekly_used` reale ad ogni tick. (Lega con #8 g_spot + con i pezzi P4/P5 della DIAGNOSI.)

### 16. (contesto, non bug) Distribuzione weekly con orari lavorativi — verificata OK
- Orari `Europe/Rome 08-20` = 06-18 UTC = 12h attive/die. Il bridge distribuisce il weekly sulle ore ON (`residual_to_reset`), non 24/7. Pace sostenibile per chiudere a 100% al reset. Vedi `DIAGNOSI-pacing-weekly-2026-06-03.md` per il modello completo.

---

## Note di contesto (non bug, da sapere)
- **DMG/exe non firmati** (no secret Apple/Windows in CI) → Gatekeeper (Mac) / SmartScreen (Win) bloccano al primo avvio. Documentato in `docs/release.md`, ma è frizione per beta tester.
- **Pacing OK**: con working hours 8-20 (84h/sett) + ratio Codex seed 14.7% → target 40.49%/finestra, sostenibile 7gg. Le 84h sono nello sweet spot Codex (38-136h).
