<!-- @translation: fr, ai-translated 2026-06-06 -->
# 🧭 Job Hunter — Architecture de l'equipe

---

## 🧠 Comment les agents sont repartis par niveau

JHT assigne chaque role a l'un de **quatre niveaux**, classes du plus eleve au plus bas. Le niveau indique le modele + l'effort de raisonnement que le launcher transmet a la CLI du fournisseur actif.

| Niveau | Agents | Claude | Codex | Kimi | Ce qu'il fait |
|---|---|---|---|---|---|
| 🥇 **very smart** | 👨‍✈️ Captain | `opus-4-7` · effort `high` | `gpt-5.5` · reasoning `high` | `k2.6` · `standard` | Decisions critiques et irreversibles — profondeur maximale de raisonnement |
| 🥈 **expert** | 👨‍🏫 Writer · 👨‍⚖️ Critic · 🧙‍♂️ Mentor | `opus-4-7` · effort `medium` | `gpt-5.5` · reasoning `high` | `k2.6` · `standard` | Pattern-matching sur des modeles bien connus (CV, revision en aveugle, analyse d'ecarts) |
| 🥉 **smart** | 🕵️ Scout · 👨‍🔬 Analyst · 👨‍💻 Scorer · 👩‍💼 Assistant | `sonnet-4-6` · effort `high` | `gpt-5.5` · reasoning `medium` | `k2.6` · `standard` | Recherche, scraping, scoring, chat avec l'utilisateur |
| 🎖️ **medium** | 💂 Sentinel | `sonnet-4-6` · effort `medium` | `gpt-5.5` · reasoning `medium` | `k2.6` · `standard` | Watchdog leger — regles if-then, pas de raisonnement profond |

**Niveaux d'effort disponibles (pour reference) :**

- **Claude** — `low · medium · high · xhigh · max` (Opus 4.7, Apr 2026). `xhigh`/`max` non utilises pour l'instant — compromis de couts.
- **Codex** — `minimal · low · medium · high · xhigh` (GPT-5.5). Default `medium`.
- **Kimi** — la CLI n'expose pas encore de niveaux d'effort, donc tous les niveaux convergent sur un seul appel.

---

## 🗺️ Pipeline en un coup d'oeil

```
   👤 User
     │
     ▼
   👨‍✈️ Captain ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──────► Phase 5 ──► 👤 User
                  🕵️ Discover  👨‍🔬 Verify  👨‍💻 Score   👨‍🏫 👨‍⚖️ Write+Review   📲 Notify
```

Chaque phase ci-dessous correspond a un role d'agent specialise. Le Captain decide **combien d'instances** lancer par role a tout moment — le nombre d'agents est dynamique, pas inscrit dans l'architecture.

---

## 1️⃣ Phase 1 — Discovery 🔍 🕵️

```
        👤 candidate_profile.yml ──┐
                                    │ circles, filters, work_mode
                                    ▼
        ┌──────────────────────────────────────┐
        │ 🕵️ Scout pool                       │
        │ N instances · Captain-managed         │
        │ peer-coordinated (no overlap on       │
        │ circles / sources / URLs)             │
        └────────────────────┬─────────────────┘
                             │ INSERT positions  (status = new)
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │ ──► Phase 2
                       └──────────────┘
                             ▲
                             │ [FEEDBACK]
                             │ (rejection patterns:
                             │  SENIORITY · STACK · GEO · LINGUA)
                             └── from 👨‍🔬 Analyst / 👨‍💻 Scorer
```

**Ce que font les Scout.** Extraient des offres d'emploi depuis les job boards et les ATS, dedupliquent par rapport a `jobs.db` et inserent les nouvelles positions avec `status = new`. S'arretent quand le Captain l'ordonne.

### 🤝 Coordination multi-scout

Plusieurs Scouts tournent en parallele sans jamais recuperer la meme offre deux fois :

- 🗺️ **Partition au boot** — les peers se decouvrent mutuellement via `tmux list-sessions`, puis negocient leur territoire a travers `scout_coord.py` (quels **circles** et **sources** chacun possede).
- 🎯 **Circles** — perimetres concentriques, epuises de l'interieur vers l'exterieur : ① preference primaire → ② voisins geographiques → ③ relocalisation ciblee → ④ satellite → ⑤ frontiere (roles adjacents).
- 📚 **Source tiers** — draines dans l'ordre : LinkedIn → agregateurs ATS (Greenhouse/Lever/Indeed/Wellfound) → boards de niche (PyJobs, RemoteOK, regionaux) → WebSearch + pages carrieres.
- ⚖️ **Anti-bias** — si plus de 30 % des positions d'un batch proviennent du meme employeur, le Scout change de source/query pour le batch suivant. Sans ce mecanisme, une scaleup qui publie 12 roles sur un seul board inonderait le pool, etouffant la diversite.
- 🛡️ **Anti-collision** — verification de deduplication sur `positions.url` avant chaque `INSERT` ([`anti-collision.md`](../_manual/anti-collision.md)).

### 🔁 Ecoute du feedback

Les Scout recoivent des messages `[FEEDBACK]` des Analyst (et indirectement des Scorer via le Captain) etiquetes avec `[SENIORITY] · [STACK] · [GEO] · [LINGUA]`, et ajustent queries/sources pour le batch suivant. Les biais systemiques sont escalades au Captain.

### 🛠️ Skills

Disponibles sous `/app/shared/skills/` :

- **`scout_coord.py`** — partition du territoire au boot (quel Scout possede quels circle/source) ; utilise pour negocier la propriete et verifier l'affectation.
- **`db_query.py check-url`** — gate de deduplication. Execute avant chaque insert ; retourne `TROVATA` (skip) ou `NON TROVATA` (proceder).
- **`db_insert.py position`** — ecrit une offre verifiee dans `positions`. Champs obligatoires : title, company, URL, location, texte JD, exigences.
- **`db_update.py position`** — utilise pour marquer les enregistrements deja inseres comme `excluded` quand un doublon echappe. Jamais de DELETE.
- **`linkedin_check.py`** — enrichissement authentifie sur LinkedIn (job IDs → metadonnees completes de l'offre) sans declencher le blocage robots de `fetch` MCP.

### 🌐 MCP tools

- **`jobspy`** — scraper multi-source pour job boards (LinkedIn, Indeed, ZipRecruiter, Glassdoor) encapsule en MCP. Decouverte rapide en masse, sortie normalisee.
- **`linkedin`** — MCP dedie a LinkedIn pour la recherche + la recuperation d'offres.
- **`fetch`** — fetch HTTP generique pour les pages d'agregateurs ATS (Greenhouse, Lever, Wellfound). ⚠️ Bloque par le robots.txt de LinkedIn — les Scout se rabattent sur `curl` avec un user-agent de navigateur la-bas.
- **`playwright`** — navigateur headless pour les pages carrieres JS-heavy ou le simple `fetch` ne rend pas le DOM.
- **`WebSearch`** *(built-in)* — fallback de niveau 4 quand les ATS/boards de niche sont epuises.

---

## 2️⃣ Phase 2 — Verification ✅ 👨‍🔬

```
                       📦 jobs.db
                       (status = new)
                              │
                              ▼
        ┌──────────────────────────────────────┐
        │ 👨‍🔬 Analyst pool                      │
        │ N instances · Captain-managed         │
        │ peer-coordinated (last_checked        │
        │ timestamp prevents double-work)       │
        └────────────────────┬─────────────────┘
                             │ UPDATE positions
                             │   status = checked   → Phase 3
                             │   status = excluded  → 🗄️ archive
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │
                       └──────────────┘
                             │
                             │ [FEEDBACK]
                             │ (rejection patterns:
                             │  SENIORITY · STACK · GEO · LINGUA …)
                             ▼
                        🕵️ Scout pool
```

**Ce que font les Analyst.** Prennent les positions avec `status = new`, recuperent la JD en direct, valident le lien, analysent 5 champs structures (`ESPERIENZA_RICHIESTA · ESPERIENZA_TIPO · LAUREA · LINGUA_RICHIESTA · SENIORITY_JD`), et les promeuvent a `checked` ou les marquent comme `excluded`. Les annees reelles sont calculees a partir des entrees datees du profil, pas du champ arrondi `experience_years`. Le candidat est traite comme **adaptable** — les stacks adjacents ne sont pas exclus, le Scorer applique une penalite proportionnelle d'ecart en aval.

### 🚫 Tags d'exclusion

Les notes d'exclusion commencent par `ESCLUSA: [TAG]` — `[LINK_MORTO]` · `[SCAM]` · `[GEO]` · `[LINGUA]` · `[SENIORITY]` (`req > real+3` ou JD senior/lead) · `[STACK]` (hors domaine). En cas d'incertitude → `checked` : les faux negatifs coutent plus que les faux positifs.

### 🤝 Coordination multi-analyst

- 🕒 **Watermark `last_checked`** — les Analyst sautent les enregistrements recemment mis a jour par un pair.
- 🛡️ **Contrat anti-collision** — [`agents/_manual/anti-collision.md`](../_manual/anti-collision.md).

### 🔁 Feedback aux Scout

Quand 3 exclusions consecutives touchent la meme source avec le meme tag, ou qu'un batch d'un Scout depasse 60 % de taux de rejet, l'Analyst envoie un `[FEEDBACK]` a ce Scout — specifique (source + tag + IDs), actionnable (alternative suggeree), idempotent (un par pattern).

### 🛠️ Skills

- **`db_query.py next-for-analista`** — recupere la prochaine position `status=new` en respectant le watermark `last_checked`.
- **`db_query.py position <ID>`** — recupere la JD complete + metadonnees pour l'analyse.
- **`db_update.py position <ID>`** — ecrit le nouveau status (`checked` ou `excluded`) + notes structurees.
- **`linkedin_check.py`** — verification authentifiee sur LinkedIn (actif / expire / infos entreprise).

### 🌐 MCP tools

- **`fetch`** — GET de la JD en direct avec `-L` + browser UA ; detecte les marqueurs "expired / closed-job".
- **`playwright`** — fallback pour les pages ATS JS-heavy que `fetch` ne peut pas rendre (Workable/Lever/Ashby).
- **`linkedin`** — contourne : les verifications LinkedIn passent par `linkedin_check.py` (authentifie).

---

## 3️⃣ Phase 3 — Scoring 🎯 👨‍💻

```
                       📦 jobs.db
                       (status = checked)
                              │
                              ▼
        ┌──────────────────────────────────────┐
        │ 👨‍💻 Scorer pool                       │
        │ N instances · Captain-managed         │
        │ peer-coordinated (last_checked < 5min │
        │ = peer claimed → skip)                │
        └────────────────────┬─────────────────┘
                             │ INSERT scores · UPDATE positions
                             │   score ≥ 50  → status = scored   → Phase 4
                             │   score 40-49 → status = scored   (parking)
                             │   score < 40  → status = excluded → 🗄️ archive
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │
                       └──────────────┘
                             │
                             │ score distribution
                             │ (high-score zones → Scout queries)
                             ▼
                        🕵️ Scout pool  (via 👨‍✈️ Captain)
```

**Ce que font les Scorer.** Executent un **pre-check** (annees d'experience, localisation, diplome obligatoire sans "ou equivalent") pour filtrer les positions non evaluables, puis attribuent un score 0-100 par rapport au profil du candidat. `< 40` → `excluded`. `40-49` → `scored` (parking, le Captain decide apres). `≥ 50` → `scored` + notification aux Writer.

### 🧮 Formule de scoring (0-100)

| Composante | Poids | Colonne DB | Ce qu'elle mesure |
|---|---|---|---|
| Stack match | 35 | `stack_match` | Competences requises vs stack du candidat |
| Seniority fit | 25 | `experience_fit` | Annees requises vs annees reelles du candidat |
| Remote / location | 20 | `remote_fit` | Compatibilite avec les preferences de localisation du profil |
| Salary fit | 10 | `salary_fit` | Fourchette proposee vs objectif |
| Stack bonus | 10 | `strategic_fit` | Bonus technologique (AI · cybersec · fintech, si ce sont des points forts du candidat) |

Penalites appliquees en plus : `−10` diplome obligatoire sans "ou equivalent" · `−15` langue obligatoire non parlee · `−5` JD vague sans exigences concretes.

### 🤝 Coordination multi-scorer

- 🕒 **Claim `last_checked`** — le Scorer marque le timestamp avant d'evaluer ; les pairs sautent les enregistrements reclames dans les 5 dernieres minutes.
- 🛡️ **Perimetre d'ecriture DB** — le Scorer ecrit `scores` (INSERT) et uniquement `positions.status`. Ne touche jamais `applications`, `companies`, ou `positions.notes` (territoire de l'Analyst).
- 🛡️ **Contrat anti-collision** — [`agents/_manual/anti-collision.md`](../_manual/anti-collision.md).

### 🔁 Feedback aux Scout (via Captain)

La distribution en direct des scores du Scorer (par source / role / geo / stack) est lue par le Captain et retransmise aux Scout, pour que les prochains batches se concentrent sur les zones a haut score du candidat.

### 🛠️ Skills

- **`db_query.py next-for-scorer`** — recupere la prochaine position `status=checked` en respectant `last_checked`.
- **`db_query.py position <ID>`** — enregistrement complet + notes structurees de l'Analyst (les entrees de la formule).
- **`db_insert.py score`** — ecrit le detail (5 composantes + total).
- **`db_update.py position <ID>`** — definit `status = scored | excluded`.

### 🌐 MCP tools

- **`fetch`** — re-valide le lien avant le scoring (les offres meurent vite — la Phase 2 peut remonter a un moment).

---

## 4️⃣ Phase 4 — Writing + Review ✍️ 👨‍🏫 👨‍⚖️

```
                       📦 jobs.db
                       (status = scored, score ≥ 50)
                              │  selection: ≥70 first, then 50-69 desc
                              ▼
        ┌──────────────────────────────────────┐
        │ 👨‍🏫 Writer pool                       │
        │ N instances · Captain-managed         │
        │ peer-coordinated (status=writing      │
        │ claim prevents double-work)           │
        └────────────────────┬─────────────────┘
                             │ for each position:
                             │   3× rounds with a fresh Critic
                             ▼
        ┌──────────────────────────────────────┐
        │ 👨‍⚖️ Critic (CRITICO-S<N>)            │
        │ spawned fresh per round, killed after │
        │ blind review — no profile access      │
        └────────────────────┬─────────────────┘
                             │ critic_score 1-10
                             │ after round 3:
                             │   score ≥ 5 → status = ready    → Phase 5
                             │   score < 5 → status = excluded → 🗄️ archive
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │
                       └──────────────┘
```

**Ce que font les Writer.** Prennent les positions `status = scored` en ordre decroissant de score (d'abord les ≥70, puis les 50-69), les reservent en definissant `status = writing`, generent un CV sur mesure (Cover Letter uniquement si la JD la demande), puis executent **3 rounds obligatoires** avec le Critic. Entre les rounds, le Writer corrige le CV et regenere le PDF. Gate final : `critic_score ≥ 5` → `ready`, sinon `excluded`. **Zero invenzioni** — chaque affirmation dans le CV doit etre tracable jusqu'a `candidate_profile.yml`.

**Ce que fait le Critic.** Cree de zero pour chaque round (`CRITICO-S<N>`), recoit le chemin du PDF + URL de la JD, effectue une **revision en aveugle** (sans acces au profil — uniquement la page devant lui), retourne un verdict structure : vote X/10 + analyse structure/pertinence/impact + tableau exigences-vs-CV + actions priorisees. Elimine apres chaque revision — jamais reutilise. Utilise l'echelle complete 1-10 ; pas de votes de courtoisie.

La boucle Writer ↔ Critic est la phase la plus consommatrice de tokens. Les deux sont au niveau **expert** (modele top + effort moyen) — la tache est bien definie, pas besoin de raisonnement exploratoire.

### 🤝 Coordination multi-writer

- 🛡️ **Claim `status = writing`** — les Writer changent le status avant d'ecrire ; les pairs sautent les enregistrements deja reserves.
- 🚫 **Anti-rewriting** — si `critic_verdict` est deja defini, **skip absolu** (le verdict est final, pas de re-revision).
- 📡 **Perimetre d'ecriture DB** — le Writer touche uniquement `positions.status` et `applications` ; jamais `scores`, `companies`, `positions.notes`.

### 🛑 Captain freeze

Quand le Sentinel signale une saturation de rate-limit, le Captain envoie `[URG] FREEZE` aux Writer. Ils terminent le round en cours s'ils sont a mi-boucle (n'abandonnent jamais un Critic en pleine revision), puis dorment jusqu'a ce que le throttle revienne a T0/T1.

### 🛠️ Skills

- **`db_query.py next-for-scrittore`** — recupere la prochaine position en ordre decroissant de score.
- **`db_update.py position`** — change `status = writing | ready | excluded`.
- **`db_insert.py application`** — enregistre la candidature + chemins CV/PDF.
- **`db_update.py application`** — sauvegarde `critic_score · critic_verdict · critic_round · critic_notes` par round.
- **`pandoc`** — convertit le CV markdown en PDF via le moteur Typst.

### 🌐 MCP tools

- **`fetch`** — re-valide le lien de la JD avant d'ecrire ; le Critic utilise le meme MCP pour lire la JD en direct.
- **`WebFetch`** / **`WebSearch`** — fallback quand `fetch` ne peut pas atteindre la JD (blocages LinkedIn / robots.txt).

---

## 5️⃣ Phase 5 — Notify 📲

```
                       📦 jobs.db
                       (status = ready)
                              │
                              ▼
                    👨‍✈️ Captain receives [RES]
                    from Writer (PDF + verdict)
                              │
                              ▼
                       📲 Telegram bot
                    (position · CV PDF · job link)
                              │
                              ▼
                         👤 User
                          ① reads the CV
                          ② sends feedback to 👨‍✈️ Captain
                          ③ applies manually using the link
                              │
                              ▼
                       📦 jobs.db
                       (status = applied — set by user)
```

**Ce qui se passe.** Quand un Writer cloture la Phase 4 avec `verdict = PASS` et `status = ready`, le Captain recoit un message `[RES]` avec le PDF et le verdict. Un message Telegram est envoye a l'utilisateur avec le titre du poste, l'entreprise, le CV PDF genere et le lien vers l'offre.

**Pourquoi l'etape de candidature est entierement manuelle.** L'utilisateur lit le CV, juge lui-meme la compatibilite, envoie du feedback au Captain (`le ton ne convient pas` · `il manque cette experience` · `bien — je postule` · ...), et **decide ensuite seulement s'il postule** — en utilisant le lien qu'il a deja. Ce checkpoint humain est intentionnel : il maintient JHT comme un coach pour le travailleur, pas un canon qui bombarde les recruteurs de candidatures a faible effort. Le volume cote recruteur n'a de sens que si le travailleur l'a choisi.

**Mise a jour du status.** Quand l'utilisateur postule, la position est marquee `status = applied` manuellement (reponse Telegram ou bouton "J'ai postule" dans le web dashboard), avec `applied_via = telegram | web | manual`. Le cycle optionnel `response` (`interview` · `rejected` · `ghosted`) est egalement suivi par l'utilisateur.

### 🛠️ Skills / tools

- **`.launcher/tg-bridge.py`** — bridge Telegram (Python) : notifications sortantes et feedback / mises à jour de statut de l'utilisateur entrants, un bot par rôle user-facing.
- **`positions.applied`** — flag DB change par l'utilisateur (jamais automatiquement par l'equipe).

---

## 🎮 Orchestration de la pipeline

La pipeline n'est pas une configuration statique avec N instances par role : c'est une **boucle pilotee par le feedback** que le Captain gere dynamiquement en fonction du debit, de la profondeur des files et du budget de l'utilisateur. Les chiffres ci-dessous sont illustratifs, pas normatifs.

### 🥾 Cold start — remplir l'entonnoir

Quand la pipeline demarre de zero, la priorite est d'alimenter les files en aval rapidement :

```
   T=0       →  3× 🕵️ Scout                                    (flood the funnel)
   T+ a bit  →  2× 🕵️ Scout · 1× 👨‍🔬 Analyst                    (first offers to verify)
   T+ more   →  2× 🕵️ Scout · 1× 👨‍🔬 Analyst · 1× 👨‍💻 Scorer    (first verified ready to score)
```

Si l'Analyst prend du retard par rapport aux Scout, le Captain reequilibre a la volee : `+1 Analyst · −1 Scout`. La meme logique s'applique en aval.

### 🔁 Feedback loop — recherche auto-ajustee

Le premier batch traite par chaque role en aval est **en or** — ce sont les donnees que l'agent en aval utilise pour instruire celui en amont :

- **👨‍🔬 Analyst → 🕵️ Scout** — apres un premier batch significatif, l'Analyst signale les patterns de rejet (entreprises qui ferment les offres vite, boards frauduleux, formes de JD qui echouent toujours a la verification). Les Scout les sautent en amont.
- **👨‍💻 Scorer → 🕵️ Scout** — une fois que le Scorer a vu un echantillon, il sait quels roles/stacks/geographies scorent haut. Il retransmet la distribution pour que les Scout cherchent plus pres des zones a haut score.

Resultat : a chaque cycle, les Scout trouvent de meilleures offres, les Analyst rejettent moins de bonnes offres, les Scorer voient des distributions de scores plus elevees. L'equipe devient un **systeme auto-ajuste**.

### 🎯 Gate d'activation du Writer

Les boucles Writer + Critic sont la partie la plus couteuse de la pipeline (modele top-tier, revision iterative). Ils **alternent** — le Writer attend pendant que le Critic revise et vice versa — donc une paire Writer + Critic coute environ **un agent continu**, pas deux.

Pour eviter de depenser ces tokens sur des offres mediocres, le Captain conditionne l'activation des Writer a la profondeur de la file a haut score :

1. Trie les positions en file par score decroissant.
2. Attend que suffisamment d'offres a haut score se soient accumulees (ex. **10+ offres avec score ≥ 75**).
3. Lance les Writer — ils commencent toujours par la position avec le score le plus eleve en file.

### 💰 Throttling budget-aware

Tous les compteurs d'instances et seuils de gate s'adaptent au budget mensuel de l'utilisateur et au signal d'utilisation en direct du side-channel [📡 Bridge → 💂 Sentinel](#-side-channel--usage-monitoring). Un bootstrap agressif avec un budget serre est ralenti avant que l'ecriture de qualite ne commence — mieux vaut sauter quelques offres que bruler le budget sur la Discovery sans rien garder pour la Writing.

---

## 📡 Side-channel — Suivi de l'utilisation

Hors de la pipeline. Tourne en continu en parallele.

```
   ┌────────────┐  every tick  ┌────────────┐  notify on edge  ┌────────────┐
   │ 📡 Bridge  │ ───────────► │ 💂 Sentinel│ ───────────────► │ 👨‍✈️ Captain│
   │ (process,  │ usage + proj │ tier:      │  only on real    │            │
   │  not Claude│              │  medium    │  state changes   │            │
   │  agent)    │              │ event-     │                  │            │
   └────────────┘              │ driven     │                  └────────────┘
                               └────────────┘
```

**Bridge.** Un processus non-AI qui interroge la CLI de chaque agent pour l'utilisation actuelle et l'epuisement projete. Envoie un tick au Sentinel.
**Sentinel.** Edge-triggered : ingere chaque tick mais parle au Captain *seulement* quand quelque chose change vraiment (pic d'utilisation, violation de la projection, crash d'un agent).
**Captain.** Reagit — ralentit, gele l'equipe, tue les sessions problematiques — en fonction du signal du Sentinel.

---

## 🤝 Side-channel — Helpers orientes utilisateur

```
                        👤 User
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
       👩‍💼 Assistant  👨‍✈️ Captain   🧙‍♂️ Mentor
       platform      team commander  career coach
       copilot                       (always-on)
```

- **👩‍💼 Assistant** — `tier: smart`. Traduit les demandes non techniques de l'utilisateur en ordres pour le Captain. Cache les details d'implementation du chat oriente utilisateur.
- **🧙‍♂️ Mentor** — `tier: expert`, **actif** (bases livrees, optimisation en cours). Career coach : analyse l'ecart profil/resultats, produit un plan d'action, points strategiques reguliers. Oriente utilisateur, toujours actif, cree au boot. Dossier : `agents/mentor/`.

---

## 🩺 Side-channel — Sante & maintenance

Hors de la pipeline. Agents **planifies one-shot** : le watchdog en cree un sur son creneau quotidien ; ils executent un balayage, font leur rapport au Captain, puis s'autodetruisent.

```
   ┌────────────┐  daily slot  ┌──────────────┐  report  ┌────────────┐
   │ watchdog   │ ───────────► │ 🩺 Dottore   │ ───────► │ 👨‍✈️ Captain│
   │ (scheduler)│              │ 👷‍♂️ Mantenitore│  findings │            │
   └────────────┘              └──────────────┘          └────────────┘
                                  one-shot → self-destruct
```

- **🩺 Dottore** — **sante des agents**. Rafraichissement periodique du contexte + retrospective : detecte les sessions d'agents bloquees/zombies et les redemarre avec un contexte neuf (les threads longue duree qui brulent du contexte provoquent un effondrement silencieux du debit). Dossier : `agents/dottore/`.
- **👷‍♂️ Mantenitore** — **sante de l'infra**. Balayage de maintenance quotidien sur le conteneur/VPS : smoke-test des outils mission-critical (canary navigateur/Playwright), standardisation des dependances (`jht-install`), tendance disque/RAM, GC des orphelins. Un outil crucial casse est un P1. Dossier : `agents/mantenitore/`.

---

## 💬 Communication

```
   ┌──────────┐   tmux send-keys    ┌──────────┐
   │ Captain  │ ◄─────────────────► │ Agents   │
   │          │   [@from -> @to]     │ (one     │
   │          │   MSG / REQ / RES /  │  tmux    │
   │          │   URG                │  session │
   └────┬─────┘                      │  each)   │
        │                            └──────────┘
        │  Telegram bot
        ▼
    📲 User
```

Les messages inter-agents utilisent une enveloppe etiquetee (`[@scout-1 -> @capitano] [REQ] ...`). Protocole complet : [`agents/_manual/communication-rules.md`](../_manual/communication-rules.md).

---

## 🔗 Liens

- 📋 [`agents/_manual/`](../_manual/) — documents de reference operationnelle consommes a l'execution (schema DB, protocole de communication, contrat anti-collision)
- 📜 [`docs/adr/`](../../docs/adr/) — decisions architecturales (CLIs supportees, single-writer, subscription-only)
