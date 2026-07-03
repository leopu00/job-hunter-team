# 🔴 Sync-web release gate — i metadati Parte B non arrivano al cloud

**Data:** 2026-06-15 · **Lane:** dev2 (sync/web) — documentato da dev1 (overview) · **Vale per:**
betaB + betaA (entrambe le VPS).

## 🎯 Il finding

Tutta la pipeline metadati della **Parte B** è costruita e deployata lato VPS, ma **non un solo
campo nuovo arriva al cloud** perché il web (Vercel) deploya dal branch **`production`**, fermo a un
HEAD pre-fix.

## 🔗 La catena (cosa è pronto vs cosa è il gate)

| Anello | Stato | Dettaglio |
|---|---|---|
| Analista produce metadati | ✅ pronto, live | `role_family`, `loc_city/country`, `work_mode`, `salary_estimated`, `salary_precise`, geocoding ufficio + `last_actor` |
| Device push (`cli/src/commands/cloud.js`) | ✅ su master | invia i campi nuovi (delta) |
| Route ricevente (`web/app/api/cloud-sync/push/route.ts`) | ✅ su **master** | upsert dei campi nuovi |
| Migration cloud 038/039/040 | ✅ applicate | expiry/is_open, last_actor, salary_precise |
| **Web live (Vercel)** | 🔴 **VECCHIO** | deploya da **`production`** = HEAD `3fb7b764d` (6/6) → la route live **scarta** i campi nuovi |

→ Il route nuovo esiste solo su `master`. Vercel serve `production`. Finché non c'è la **release
master→production**, la route live è quella vecchia e i metadati vengono **droppati in ingresso**.

## 🧪 Evidenza

- `production` HEAD = `3fb7b764d` ("ripristina versione 0.1.20", 6/6) — verificato locale + da dev2.
- Cloud: `last_actor = 0` ovunque, `loc_city = 301`, `role_family = 453` (valore **stale** anteriore,
  NON i metadati nuovi). I metadati di betaA (`role_family = 255` in SQLite) **non** compaiono sul
  cloud (lì `role_family` è tutto NULL per betaA → vedi nota sync per-user).
- `last_actor = 0` ovunque è la prova-cartina di tornasole: la colonna nuova non viene mai scritta →
  la route live non la conosce.

## 📉 Conseguenza

Category chart, mappa e "Aggiornato da" sulla dashboard cloud restano **vuoti/stale** finché non si
fa la release — per tutti gli utenti, su entrambe le VPS. Il lavoro Parte B è invisibile sul prodotto.

## 🪤 Trappola correlata: il legacy drift segue il primo sync utile

Quando la release sblocca il sync, anche il **drift legacy** di `role_family` arriva al cloud — non
serve un re-push forzato: basta il **sync incrementale** (una riga legacy recheckata → `updated_at`
cambia → il daemon la pusha col `role_family` driftato). Quindi la normalizzazione legacy→canonico
(via sync-normalizer JS, vedi `2026-06-15-taxonomy-upstream-fix-e-domain-gaps.md`) deve atterrare
**insieme/prima** della release, altrimenti il grafico categoria parte già frammentato (47 fette).

## 🚦 Il gate (azione utente)

**RELEASE master→production** + deploy Vercel. È l'**unico** nodo aperto per portare i metadati al
cloud. Per convenzione il merge in `master` e la release li fa **l'utente** (gli agenti dev-N non
toccano master). Deploy VPS + migration cloud sono già pronti da 2026-06-14.

> Diverso dal gap storico `project_sync_gap_companies_highlights` (companies/highlights mai coperti
> dalla route): qui i campi **sono** coperti dal codice su master — manca solo il *rilascio* del
> branch che Vercel serve.
