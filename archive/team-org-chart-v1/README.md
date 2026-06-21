# team-org-chart-v1 — archivio

Pagina `/team-pyramid` ("Org chart" / piramide del team). **Archiviata**, non
cancellata: non serve più nell'app, ma la teniamo nel caso torni utile.

## Cos'era

`app/page.tsx` — una piramide statica dei ruoli del team (apice User, poi
Captain/Mentor, Oversight, ecc.), pagina autonoma (importa solo `Link`).
Era raggiungibile dal menu a ingranaggio (voce "Org chart"), ora rimosso.

## Come riprenderla

Riportare `app/` sotto `web/app/(protected)/team-pyramid/` e, se serve,
rimettere la voce in `web/components/SettingsMenu.tsx` (sezione Team →
`/team-pyramid`). NB: il menu a ingranaggio (`SettingsMenu`) non è più montato
nella nav; il toggle tema è stato spostato in `/settings` (tab Generale).
