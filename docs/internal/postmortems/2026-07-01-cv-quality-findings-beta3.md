# 📄 Qualità CV — 4 difetti trovati sui 30 CV di beta-3 (2026-07-01)

Contesto: i 30 CV+CL prodotti (a torto) dal team beta-3 — profilo **betaD Olivar**, Luxury Hospitality (vedi `2026-07-01-capitano-kimi-thinking-off-writer-gate.md` per il *perché* sono stati scritti). L'utente li ha letti e ha segnalato problemi di qualità. Indagine + fix qui sotto. **NB: Scrittore e Critico giravano a thinking ON** — questi difetti NON derivano dal thinking-off, sono difetti di **skill/template**.

## I 4 difetti (tutti confermati con evidenza)

### 1. 🔁 Lingue ripetute 3× nella stessa pagina — strutturale
La skill `cv-structure` metteva le 4 lingue in tre sezioni: Header (`🗣`), fine About Me, e tabella "Technical Skills → Languages". Nessuna regola imponeva "una volta sola". Verificato su tutti i CV.

### 2. 🧊 Freddo / templatizzato / registro sbagliato — il template è per DEV
`cv-structure` era tarata su CV **tech**: pattern "metric in bold + **tech** in parens", tabella **"Technical Skills"** con esempio `Python, Go, Bash`, verbi "Built/Shipped/Architected", divieto di frasi calde. Applicata a una **hostess di lusso** sterilizza il selling point. Confronto:

- **Originale di betaD** (`/jht_home/profile/sources/`): *"Esperienza maturata all'interno di Nobu Hospitality… fondato da Nobu Matsuhisa, Robert De Niro e Meir Teper… mi faccio distinguere per una spiccata intelligenza emotiva…"* — narrativa, contesto, personalità.
- **Generato**: *"VIP guest welcome and assistance at an international luxury brand in Rome"* — bullet secco, contesto buttato.

### 3. 📄 Non legge il CV originale — gap di design
La skill tracciava tutto da `candidate_profile.yml` (dati piatti). Gli originali caricati dall'utente stanno in **`$JHT_HOME/profile/sources/`** (`betaD_Olivar_CV_Luxury_Hospitality.pdf`) e **non venivano mai letti** → voce e stile persi. Il profilo ha già `industry: Luxury Hospitality`, mai usato per commutare registro.

### 4. 🏷️ Cover letter intitolata "CV" — bug preciso
`cv-structure` genera i PDF con `--metadata title="CV $CANDIDATO"` (riga ~197). Lo Scrittore ha usato **lo stesso comando anche per le cover letter** → titolo documento **"CV betaD Olivar"** su tutte e 31. La skill non aveva un percorso PDF dedicato per la cover letter.

### Bonus — il Critico non li ha fermati
I CV sono passati 3 round di blind-review con PASS nonostante la tripla ripetizione. La rubrica `blind-review` non aveva check espliciti su ripetizione e registro. (Il titolo "CV" delle cover letter **non** è colpa del Critico: `CR-04` gli vieta di revisionare le cover letter — si chiude a monte, nella generazione.)

## Fix applicati (dev2)

| # | Difetto | Fix | File |
|---|---|---|---|
| 1 | Lingue 3× | Regola "Languages appear ONCE" (Header only) | `cv-structure/SKILL.md` |
| 2 | Registro dev | Tabella "register by profile family" (tech vs hospitality/sales/care/creative): Section 4 rinominata, niente linguaggi di programmazione, calore ammesso dove è il selling point | `cv-structure/SKILL.md` |
| 3 | Non legge originale | Step "Before you write: read `$JHT_HOME/profile/sources/`, mirror voice + register" + hard rule | `cv-structure/SKILL.md` |
| 4 | Titolo "CV" su CL | Blocco pandoc dedicato `--metadata title="Cover Letter $CANDIDATO"` + anti-pattern | `cv-structure/SKILL.md` |
| 5 | Critico lasco | "Mandatory defect checks": repetition, register-fit, interchangeability (blind-compatible) | `blind-review/SKILL.md` |

## Residui / note

- Modifiche solo su **SKILL.md (EN)**. Le 6 traduzioni (`it/es/de/fr/hu/pt`) di `cv-structure` e `blind-review` restano indietro (flotta gira skill EN — residuo accettato, come da prassi). Da riallineare se una skill viene servita in lingua.
- Latente, fuori scope: `critic-loop/SKILL.md` step 9 cita ancora `--pdf-engine=typst` (non disponibile nel container; l'engine vero è `wkhtmltopdf` come da `cv-structure`). Incoerenza da sistemare a parte (MINOR-TRACKER).
- **GATED**: merge → master → rebuild → redeploy. E un **backfill**: i 30 CV già scritti restano coi difetti finché non li si rigenera (con la nuova skill) — ma sono lavoro non richiesto, quindi la scelta se rigenerarli o scartarli è dell'utente.
