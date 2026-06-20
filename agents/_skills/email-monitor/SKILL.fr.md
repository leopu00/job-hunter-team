<!-- @translation: fr, ai-translated 2026-06-20 -->
---
name: email-monitor
description: "Sourcing en debut de journee depuis la boite email DEDIEE de l'equipe (l'utilisateur y transfere ses propres alertes d'offres). Source la plus precise : l'alerte est deja pre-filtree sur l'intention de l'utilisateur. Poll IMAP de N'IMPORTE QUELLE plateforme (LinkedIn/Glassdoor/Indeed + boards nationaux/de ville/de niche), cree des positions avec le tag source, idempotent par Message-ID. Le VOLUME est equilibre par le Capitaine (C-16) : en debut de journee on lit l'email AVANT le scraping web ; en cas de flood on n'ingere que les saillantes, pour que le funnel arrive jusqu'au SCORE."
allowed-tools: Bash(python3 /app/shared/skills/email_monitor.py *), Bash(python3 /app/shared/skills/scout_dedup.py *), Bash(python3 /app/shared/skills/db_insert.py *), Bash(python3 /app/shared/skills/db_query.py *)
---

# email-monitor — lire les alertes d'offres transferees, en debut de journee

L'utilisateur cree un email **dedie** (ex. `nom.jht@gmail.com`) et configure sur
son client des **regles de transfert** qui nous envoient les alertes d'offres
(LinkedIn, Glassdoor, Indeed **et n'importe quelle autre plateforme** qui notifie
par mail). Tu lis cette boite et transformes les alertes en positions. C'est la
source la plus **precise** (l'alerte est deja filtree sur la cible par
l'utilisateur) et la plus **economique en tokens** (pas de scraping a l'aveugle).

> 📍 **Optionnelle mais recommandee.** Si elle n'est pas configuree, l'equipe
> travaille comme avant (web sourcing). Aucun blocage.

## Quand

- **En debut de fenetre de travail** (day-start) : lis l'email **AVANT** le
  scraping web. Les alertes nocturnes sont deja la.
- Ensuite au maximum toutes les ~30 min (l'IMAP cote serveur rate-limite au-dela,
  et de nouvelles alertes n'arrivent pas plus souvent). Ne pas poller plus
  frequemment.
- Claim de la source en STEP 0 (`scout-coord`) : `scout_workspace.py claim
  <agent> email:<box>` — un seul Scout pour la boite, aucune collision.

## Procedure

### 1. Est-elle configuree ?
```bash
python3 /app/shared/skills/email_monitor.py status
```
`configured=false` → la boite n'existe pas : passe, fais du web sourcing normal.
`any_platform=true` signifie qu'on traite **toute** l'inbox dediee (aucun
`from_filters` restreint) → chaque expediteur que l'utilisateur transfere est lu.

### 2. Estime le VOLUME (economique, pas de fetch du corps)
```bash
python3 /app/shared/skills/email_monitor.py count
```
Retourne `new_total` + `by_sender`. Sert a **toi et au Capitaine** pour savoir si
c'est un volume gerable ou un **flood**. En cas de flood, **le Capitaine (C-16) te
dit combien / lesquelles** ingerer : l'objectif est que les positions arrivent
jusqu'a un **score**, pas d'en accumuler 200 jamais evaluees.

### 3. Poll → leads
```bash
python3 /app/shared/skills/email_monitor.py poll --since-days 1
```
Chaque ligne JSONL est un lead : `{"url","source","subject","sender","received_at"}`.
- `source` = `linkedin-email` / `glassdoor-email` / `indeed-email` pour les
  providers connus, `email:<domain>` pour n'importe quelle autre plateforme
  (extraction generique).
- L'idempotence (Message-ID dans `state/email_monitor_seen.json`) garantit qu'un
  re-run **ne** retraite **pas** les memes alertes.

### 4. Pour chaque lead → les 5 gates de `position-insert`
Traite chaque `url` **exactement comme un hit web** : dedup (`scout_dedup.py`) →
verification du lien actif → fetch JD → 4 filtres Scout → INSERT dans `positions`
(`status=new`). **Conserve le tag `--source`** du lead (`linkedin-email`,
`email:<domain>`) : c'est ce qui rend **mesurable la precision par source** sur le
dashboard. JD obligatoire (SC-02) : si tu ne parviens pas a la recuperer, ne
l'invente pas.

## Equilibrage (jugement du Capitaine, C-16)

Lire est gratuit (`poll`/`count`), **traiter** jusqu'au score coute. Le decideur
est le Capitaine, pas une formule :
- Volume raisonnable → traite-les toutes (plus de signal est mieux).
- Flood → ne fais avancer que les **saillantes**, avec deux criteres a partir des
  seules metadonnees (gratuit) : **(1) match avec le profil/cible** de
  l'utilisateur (role/keyword dans le `subject`/titre) et **(2) fraicheur**
  (`received_at` plus recent). Les autres se reprennent dans les fenetres
  suivantes.
- Objectif : les positions **arrivent jusqu'a un score**, elles ne s'accumulent
  pas sans evaluation. Aucun seuil fixe — le Capitaine decide combien selon le
  budget.

## Anti-pattern

- ❌ Poller plus souvent que ~30 min (rate-limit IMAP, aucune nouvelle alerte).
- ❌ INSERT sans JD complete (SC-02) ou sans le tag `source`.
- ❌ Creer en avalanche en cas de flood en ignorant le jugement du Capitaine
  (C-16) : on gonfle la file de positions qui n'arriveront jamais a un score.
- ❌ Contourner le dedup (SC-05) : les memes alertes se repetent chaque jour.

## See also

- `position-insert` — les 5 gates d'INSERT (ton flux standard).
- `scout-coord` — claim de la source `email:*` au boot (anti-collision).
- `circles-and-sources` — le sourcing web, a faire APRES l'email en debut de journee.
