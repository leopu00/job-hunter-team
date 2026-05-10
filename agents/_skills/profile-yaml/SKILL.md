---
name: profile-yaml
description: Maintain `$JHT_HOME/profile/candidate_profile.yml` — the structured candidate data the entire team consumes. The frontend polls this file every ~2s; an invalid YAML makes the user's left panel go silently blank. Owned by the Assistente. Use this skill on EVERY new piece of information from the user (text or uploaded file): write incrementally, validate immediately, talk to the user only after the validator says VALID_YAML. Also covers `ready.flag` (the unlock for the "Vai alla dashboard" button) with its strict 3-step verify-then-announce protocol.
allowed-tools: Bash(python3 *), Bash(mkdir -p *), Bash(date *), Bash(test *), Bash(rm -f *)
---

# profile-yaml — single source of truth on the candidate

The team reads `candidate_profile.yml` for every CV, every score, every match decision. If you keep it accurate the rest of the system works; if you let it drift the Writers produce sterile CVs and the Scorer mis-matches positions.

## Path & ownership

| Path                                          | Who writes it       | Who reads it             |
|-----------------------------------------------|---------------------|--------------------------|
| `$JHT_HOME/profile/candidate_profile.yml`     | **Assistente** (you), Capitano, user via the web UI | every other agent (read-only — T10) |
| `$JHT_HOME/profile/ready.flag`                | **Assistente** (you) | the dashboard's CTA gate |

Create the directory if it does not exist:
```bash
mkdir -p "$JHT_HOME/profile"
```

## Live update — incremental, after EVERY rilevant input

The frontend polls the file every ~2s. Do not wait until the end of the conversation; **every time the user gives you a new datum, write it now**.

- "mi chiamo Mario" → write `name: Mario` immediately.
- "cerco un ruolo da cuoco" → update `target_role: cuoco` immediately.
- file uploaded with experience details → after the Read, update **all** the fields in one Write.

Each new datum = one `Write` or `Edit` on the file. Then validate. Then keep the conversation moving.

## Mandatory validation after EVERY write/edit

```bash
python3 -c 'import yaml,sys; yaml.safe_load(open(sys.argv[1]))' \
    "$JHT_HOME/profile/candidate_profile.yml" \
    && echo VALID_YAML || echo INVALID_YAML
```

If `INVALID_YAML` → read the file with `Read`, find the line the Python error pointed to, fix, validate again. **Do NOT continue the conversation with the user until VALID_YAML.** A single broken YAML wipes the entire left panel; the user thinks the app crashed.

If you forgot to add the validation step you can be sure the file is broken — there is no "probably ok". Always run it.

## YAML safety rules

The frontend's parser is strict. Five rules that prevent every issue we have seen:

1. **Block scalar (`|-` or `>-`) for any text > 60 characters** — descriptions, summaries, free notes, strengths. Inline strings break on commas, colons, quotes, newlines, parentheses.
   ```yaml
   summary: |-
     Qui puoi scrivere testo lungo, anche con virgole, due punti, apici,
     a capo, parentesi: il parser lo prende cosi' com'e'.
   ```
2. **Quote inline strings with special chars** — if you must keep a string inline and it contains `"`, `:`, `#`, `&`, `*`, `>`, `|`, `%`, `@`, wrap it in double quotes (`"…"`) or switch to block scalar.
3. **Space after every `:`** — `role: Senior` ✅ · `role:Senior` ❌.
4. **Indent with 2 spaces, never tabs** — list bullets indent at the same column as the parent's first content character.
5. **No long em dashes / smart quotes** — paste from rich-text editors injects `—`, `“`, `”`. Replace with plain `-`, `"`, or use block scalar.

## Minimum schema (the floor)

The frontend has a fallback that unlocks "Vai alla dashboard" when these are present + non-empty (so the user can proceed even before you create `ready.flag`). Populate them all:

```yaml
name: <Nome Cognome>
target_role: <ruolo target>
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

preferences:                  # CHIAVI ESATTE — il frontend cerca proprio queste
  work_mode: <remoto|ibrido|in sede|flessibile>
  work_mode_flexibility: <opzionale, testo libero>
  relocation: <true|false|"per la giusta posizione">
  salary_annual_eur: <es. "30-35k" | null>

sector_details:
  <chiavi libere, snake_case — vedi sezione sotto>
```

Le chiavi `preferences.work_mode`, `preferences.relocation`, `preferences.salary_annual_eur` sono lette letteralmente dal frontend per popolare la sezione "Preferenze di lavoro". Nomi alternativi (`work_location`, `flexible`, `remote`) restano scritti ma invisibili all'utente.

Schema completo + esempi: `candidate_profile.yml.example` nella root del repo (per documentazione, **NON copiarne i valori** — vedi anti-hallucination).

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

### Anti-hallucination del passo 2

È noto che un LLM tende a scrivere "ho fatto X" anche quando il tool call non è stato emesso. Il `test -f` esiste apposta per interromperti se hai saltato la creazione: vedi `FLAG_MISSING` e ti ricordi di tornare indietro. **Non fidarti del tuo ricordo, fidati solo dell'output di `test -f`.**

### Quando rimuovere il flag

Se durante la conversazione emerge che un campo della checklist di blocco è sbagliato o mancante (es. l'utente dice "ah no, quell'esperienza non era davvero mia"):

```bash
rm -f "$JHT_HOME/profile/ready.flag"
```

E avvisa l'utente: "ho rimesso il bottone in attesa — rivediamo questo punto prima di proseguire".

### NON creare il flag se

- l'ultima validazione del YAML ha stampato `INVALID_YAML` (anche una sola volta dopo l'ultimo Write);
- mancano: nome, ruolo target, città, anni di esperienza, email;
- mancano: skills (≥2), lingue (≥1), esperienze (≥1), titoli di studio (≥1).

## ⚠️ Anti-hallucination — la regola critica

**MAI leggere `candidate_profile.yml.example` o `candidate_profile.hr.yml.example` come fonte di valori.** Quei file documentano la *struttura*, non il candidato. Se li leggi rischi di scrivere "Mario Rossi" / "mario.rossi@example.com" nel profilo vero.

Usa SOLO:
- quello che l'utente ti ha detto in chat
- quello che hai estratto da un CV / file caricato

Se non sai un campo: **lascia `""` o ometti**, mai inventare un valore plausibile.

## Anti-patterns

- ❌ Scrivere il profilo nella tua cwd `$JHT_AGENT_DIR` invece che in `$JHT_HOME/profile/` — il frontend non lo trova.
- ❌ Saltare la validazione "tanto era una piccola modifica" — ogni Write può rompere YAML, sempre.
- ❌ Mostrare YAML / JSON / path nella chat — l'utente è non-tecnico (vedi `assistente.md` sezione linguaggio utente).
- ❌ Annunciare lo sblocco senza il `test -f` — è la classica allucinazione "ho fatto X" senza averlo fatto.
- ❌ Append (Edit) in sezioni esistenti senza riguardare il contesto — il YAML va riscritto in modo coerente, non patchato a casaccio.

## See also

- `profile-summaries` — i 4 MD discorsivi che si scrivono in parallelo al YAML.
- `onboarding-flow` — il protocollo conversazionale che decide quando aggiornare cosa.
- `chat-web` — come comunicare la conferma all'utente (1 riga, no path, no jargon).
- `agents/_team/team-rules.md` T10 — il profilo è read-only per gli altri agenti, citazione verbatim.
