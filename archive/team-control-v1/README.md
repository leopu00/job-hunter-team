# team control v1 — archivio

Prima versione della pagina privata `/team` (pannello di controllo del team:
start/stop, org chart, grafici usage/token/throttle, pannello Dottore) e la
sua rivisitazione sperimentale `/team/v2`. **Non più in uso**, conservate
perché i componenti grafici sono ricchi e riutilizzabili.

## Perché sono state archiviate

La pagina ufficiale `/team` è ora quella che era `/team/attivita`
(`web/app/(protected)/team/page.tsx`): mostra l'attività reale del team
(chi ha lavorato, quanto e quando) dall'event-log sincronizzato, con il
registro completo su `/team/log`. Il vecchio pannello di controllo e la v2
sono usciti dal routing per non esporre due viste "Team" concorrenti.

## Cosa c'è qui

- `page.v1.tsx` — la vecchia `/team`: controllo team (start/stop via command
  poller), org chart, grafici usage/token, breakdown Scrittore/Critico,
  throttle, pannello Dottore. Import relativi pensati per
  `web/app/(protected)/team/` (usa `@/app/hooks/*`, `@/lib/*` e
  `./_components/*`).
- `page.v2.tsx` — la `/team/v2` in costruzione: org chart minimale che
  pollava `/api/db/recent-writes` e animava le scritture agente→DB.
  L'endpoint (`web/app/api/db/recent-writes/route.ts`) è ancora nel codice.
- `_components/` — i componenti usati solo da queste due pagine:
  `TeamOrgChart`, `UsageChart`, `UsageTokensChart`, `TokenBreakdown`,
  `TokenTypesChart`, `AgentTokensChart`, `WriterCriticBreakdown`,
  `ThrottleChart`, `AgentActivityChart`, `DoctorPanel`, `agent-colors.ts`.

## Come ripristinare

Ricopiare i file sotto `web/app/(protected)/team/` (le due pagine come
route dedicate, es. `controllo/page.tsx`) e verificare gli import `@/…`:
`useTeamState` e le API pollate esistono ancora in `web/`, mentre l'hook
`useTeamCommandPoller` è stato rimosso da `web/app/hooks/` (era orfano) —
va recuperato dalla storia git insieme alle pagine.
