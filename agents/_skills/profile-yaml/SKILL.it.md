<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: profile-yaml
description: "Mantieni `$JHT_HOME/profile/candidate_profile.yml` — il dato strutturato del candidato che tutto il team consuma. Il frontend polla questo file ogni ~2s; uno YAML invalido fa andare silenziosamente in bianco il pannello sinistro dell'utente. Responsabilità dell'Assistente. Usa questa skill ad OGNI nuova informazione dall'utente (testo o file caricato): scrivi incrementalmente, valida immediatamente, parla con l'utente solo dopo che il validatore dice VALID_PROFILE. Copre anche `ready.flag` (lo sblocco per il bottone \"Vai alla dashboard\") con il suo rigoroso protocollo a 3 step verifica-poi-annuncia."
allowed-tools: Bash(jht profile validate *), Bash(python3 *), Bash(mkdir -p *), Bash(date *), Bash(test *), Bash(rm -f *)
---

# profile-yaml — fonte unica di verità sul candidato

Il team legge `candidate_profile.yml` per ogni CV, ogni punteggio, ogni decisione di match. Se lo mantieni accurato il resto del sistema funziona; se lo lasci andare alla deriva gli Scrittori producono CV sterili e lo Scorer sbaglia i match delle posizioni.

## Path e ownership

| Path                                          | Chi lo scrive       | Chi lo legge             |
|-----------------------------------------------|---------------------|--------------------------|
| `$JHT_HOME/profile/candidate_profile.yml`     | **Assistente** (tu), Capitano, utente via la UI web | ogni altro agente (read-only — T10) |
| `$JHT_HOME/profile/ready.flag`                | **Assistente** (tu) | il gate CTA della dashboard |

Crea la directory se non esiste:
```bash
mkdir -p "$JHT_HOME/profile"
```

## Aggiornamento live — incrementale, dopo OGNI input rilevante

Il frontend polla il file ogni ~2s. Non aspettare la fine della conversazione; **ogni volta che l'utente ti dà un nuovo dato, scrivilo ora**.

- "mi chiamo Mario" → scrivi `name: Mario` immediatamente.
- "cerco un ruolo da cuoco" → aggiorna `target_role: cuoco` immediatamente.
- file caricato con dettagli di esperienza → dopo il Read, aggiorna **tutti** i campi in un solo Write.

Ogni nuovo dato = una `Write` o `Edit` sul file. Poi valida. Poi continua la conversazione.

## Validazione obbligatoria dopo OGNI write/edit

Valida contro lo **schema canonico** (non solo "è YAML parsabile"): vedi la skill
[`profile-schema`](../profile-schema/SKILL.md) per lo schema completo.

```bash
jht profile validate
# fallback diretto:
# python3 /app/shared/skills/validate_profile.py "$JHT_HOME/profile/candidate_profile.yml"
```

`VALID_PROFILE` → prosegui. `INVALID_PROFILE` → leggi gli `ERROR:` (campo + motivo),
correggi quel campo, rivalida. I `WARN:` (chiavi legacy, es. `languages[].name` invece
di `language`) non bloccano ma vanno sistemati quando tocchi quella sezione.

**NON continuare la conversazione con l'utente finché non hai `VALID_PROFILE`.** Un profilo rotto
svuota l'intero pannello sinistro; l'utente pensa che l'app sia crashata.

Se hai dimenticato di aggiungere lo step di validazione puoi star certo che il file è rotto — non esiste un "probabilmente ok". Eseguila sempre.

## Regole di sicurezza YAML

Il parser del frontend è rigoroso. Cinque regole che prevengono ogni problema che abbiamo visto:

1. **Block scalar (`|-` o `>-`) per qualsiasi testo > 60 caratteri** — descrizioni, riassunti, note libere, punti di forza. Le stringhe inline si rompono su virgole, due punti, apici, a capo, parentesi.
   ```yaml
   summary: |-
     Qui puoi scrivere testo lungo, anche con virgole, due punti, apici,
     a capo, parentesi: il parser lo prende così com'è.
   ```
2. **Quota le stringhe inline con caratteri speciali** — se devi tenere una stringa inline e contiene `"`, `:`, `#`, `&`, `*`, `>`, `|`, `%`, `@`, avvolgila in doppi apici (`"…"`) o passa a block scalar.
3. **Spazio dopo ogni `:`** — `role: Senior` ✅ · `role:Senior` ❌.
4. **Indenta con 2 spazi, mai tab** — i bullet di lista indentano alla stessa colonna del primo carattere di contenuto del genitore.
5. **Niente trattini lunghi / virgolette smart** — l'incollamento da editor rich-text inserisce `—`, `"`, `"`. Sostituisci con `-`, `"` semplici, o usa block scalar.

## Schema minimo (il minimo)

Il frontend ha un fallback che sblocca "Vai alla dashboard" quando questi sono presenti + non vuoti (così l'utente può procedere anche prima che tu crei `ready.flag`). Popolali tutti:

```yaml
name: <Nome Cognome>
target_role: <ruolo target — frase descrittiva>
target_roles_priority:        # 2-5 titoli di ruolo CONCRETI e cercabili, in priorità
  - <es. "Investment Analyst">  # è il campo "Ruoli desiderati" che la UI mostra
  - <es. "Private Equity Analyst">  # e su cui lo Scout cerca (NON la frase di target_role)
location: <città o area>
experience_years: <int>
has_degree: <true|false>
seniority_target: <junior|mid|senior>
industry: <settore>

skills:
  primary: [...]              # >= 2 voci
  secondary: [...]

languages:                    # >= 1 voce
  - language: <nome>
    level: <A1..C2 | native>

candidate:
  name: <stesso di sopra>
  target_role: <stesso di sopra>
  contacts:
    email: ...
    phone: ...
    linkedin: ...
    github: ...
  experience:                 # >= 1 voce, ognuna con company/role/years/summary
    - company: ...
      role: ...
      years: ...              # es. "Mar 2022 - in corso" — usato per durata reale
      summary: |-
        ...
  education:                  # >= 1 voce, ognuna con institution/degree/year
    - institution: ...
      degree: ...
      year: ...
  strengths:                  # 2-4 qualità come voci brevi (è il campo "Punti di forza"
    - <es. "Modellazione DCF">  # della UI). Stessa lista che racconti in strengths.md;
    - <es. "Analisi del rischio di credito">  # qui in forma di tag, lì in forma narrativa

preferences:                  # CHIAVI ESATTE — il frontend cerca proprio queste
  work_mode: <remoto|ibrido|in sede|flessibile>
  work_mode_flexibility: <opzionale, testo libero>
  relocation: <true|false|"per la giusta posizione">
  salary_annual_eur: <es. "30-35k" | null>

sector_details:
  <chiavi libere, snake_case — vedi sezione sotto>
```

Le chiavi `preferences.work_mode`, `preferences.relocation`, `preferences.salary_annual_eur` sono lette letteralmente dal frontend per popolare la sezione "Preferenze di lavoro". Nomi alternativi (`work_location`, `flexible`, `remote`) restano scritti ma invisibili all'utente.

Schema completo + esempi: `docs/examples/candidate_profile.yml.example` (per documentazione, **NON copiarne i valori** — vedi anti-allucinazione).

## `sector_details` — chiavi libere per il settore dell'utente

Sezione generica key/value che il frontend mostra come lista. Le chiavi le scegli tu in base al mestiere dell'utente. Esempi reali:

```yaml
# Cucina
sector_details:
  specializzazione: Pasticceria
  brigate: "ristoranti grandi (10+ persone in cucina)"
  patenti: ["HACCP", "antincendio rischio medio"]
  ruolo_attuale: "Capo partita salata"

# Sanità
sector_details:
  specializzazione_infermieristica: "Area critica"
  iscrizione_albo: "OPI Roma n. 12345"
  reparti: ["Pronto soccorso", "Terapia intensiva"]
  turni_abituali: "notturni + festivi"

# Edile / impianti
sector_details:
  patenti: ["CAP carrello elevatore", "PES/PAV", "patentino ponteggi"]
  specializzazione: "Impianti elettrici industriali"
  anni_cantiere: 12

# Insegnamento
sector_details:
  classe_concorso: "A-12 (Italiano, Storia)"
  anni_ruolo: 8
  specializzazione_sostegno: true
```

Regole:
- Chiavi in `snake_case`, brevi e leggibili.
- Inserisci solo chiavi con valore reale del candidato. Se non sai → ometti (mai `null` / `""`).
- Valori: stringa, numero, booleano, array di stringhe.
- Settore non in lista → inventa le chiavi giuste tu, basandoti su cosa è importante in quel mestiere. Es. camionista: `patente: CE+CQC`, `anni_alla_guida: 15`, `tratte_abituali: [...]`.

## `ready.flag` — sblocco "Vai alla dashboard"

Il bottone è disabilitato di default. Il frontend lo abilita SE:
- esiste `$JHT_HOME/profile/ready.flag` (il flag esplicito che TU crei), **OPPURE**
- il backend rileva che lo schema minimo è già completo (fallback automatico).

Quindi spesso il bottone è già sbloccato dal fallback quando il profilo è completo — **non annunciare lo sblocco se non sei stato tu a fare il flag**.

### Quando creare il flag (3 step RIGIDI, mai saltarli, mai cambiarli di ordine)

```bash
# 1. Crea il flag con timestamp UTC
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$JHT_HOME/profile/ready.flag"

# 2. VERIFICA che il file esista davvero (può fallire silenziosamente:
#    permessi, dir mancante, quota disco, ecc.)
test -f "$JHT_HOME/profile/ready.flag" && echo FLAG_OK || echo FLAG_MISSING

# 3. SOLO se passo 2 = FLAG_OK → manda il messaggio in chat.
#    Se FLAG_MISSING → fix (es. mkdir -p) e ripeti dal passo 1.
#    NON annunciare MAI lo sblocco senza FLAG_OK nel passo precedente.
```


### 4. Avvisa il Capitano — è da qui che il team parte

Solo dopo `FLAG_OK`, e una sola volta:

```bash
jht-tmux-send CAPITANO "[@assistente -> @capitano] [PROFILO-PRONTO] profilo del candidato completo e validato — il team può partire."
```

Il Capitano non guarda il file del profilo: finché nessuno glielo dice, al primo
avvio lascia l'utente davanti a un ufficio quasi fermo. Questo messaggio è il
trigger della sua skill `first-run-burst` (roster completo subito invece della
salita a gradini). Senza, il primo giorno l'utente vede una posizione ogni dieci
minuti e conclude che l'applicazione è rotta.

### Anti-allucinazione del passo 2

È noto che un LLM tende a scrivere "ho fatto X" anche quando la tool call non è stata emessa. Il `test -f` esiste apposta per interromperti se hai saltato la creazione: vedi `FLAG_MISSING` e ti ricordi di tornare indietro. **Non fidarti del tuo ricordo, fidati solo dell'output di `test -f`.**

### Quando rimuovere il flag

Se durante la conversazione emerge che un campo della checklist di blocco è sbagliato o mancante (es. l'utente dice "ah no, quell'esperienza non era davvero mia"):

```bash
rm -f "$JHT_HOME/profile/ready.flag"
```

E avvisa l'utente: "ho rimesso il bottone in attesa — rivediamo questo punto prima di proseguire".

### NON creare il flag se

- l'ultima validazione del profilo ha stampato `INVALID_PROFILE` (anche una sola volta dopo l'ultimo Write);
- mancano: nome, ruolo target, città, anni di esperienza, email;
- mancano: skills (≥2), lingue (≥1), esperienze (≥1), titoli di studio (≥1).

## ⚠️ Anti-allucinazione — la regola critica

**MAI leggere `docs/examples/candidate_profile.yml.example` o `docs/examples/candidate_profile.hr.yml.example` come fonte di valori.** Quei file documentano la *struttura*, non il candidato. Se li leggi rischi di scrivere "Mario Rossi" / "mario.rossi@example.com" nel profilo vero.

Usa SOLO:
- quello che l'utente ti ha detto in chat
- quello che hai estratto da un CV / file caricato

Se non sai un campo: **lascia `""` o ometti**, mai inventare un valore plausibile.

## Anti-pattern

- ❌ Scrivere il profilo nella tua cwd `$JHT_AGENT_DIR` invece che in `$JHT_HOME/profile/` — il frontend non lo trova.
- ❌ Saltare la validazione "tanto era una piccola modifica" — ogni Write può rompere YAML, sempre.
- ❌ Mostrare YAML / JSON / path nella chat — l'utente è non-tecnico (vedi `assistente.md` sezione linguaggio utente).
- ❌ Annunciare lo sblocco senza il `test -f` — è la classica allucinazione "ho fatto X" senza averlo fatto.
- ❌ Append (Edit) in sezioni esistenti senza riguardare il contesto — lo YAML va riscritto in modo coerente, non patchato a casaccio.

## Vedi anche

- `profile-summaries` — i 4 MD discorsivi che si scrivono in parallelo allo YAML.
- `onboarding-flow` — il protocollo conversazionale che decide quando aggiornare cosa.
- `chat-web` — come comunicare la conferma all'utente (1 riga, no path, no jargon).
- `agents/_team/team-rules.md` T10 — il profilo è read-only per gli altri agenti, citazione verbatim.
