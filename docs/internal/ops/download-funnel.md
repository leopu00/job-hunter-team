# Download funnel: report aggregato

La rotta pubblica `/go/<slug>` incrementa soltanto bucket orari anonimi. La
tabella non contiene eventi individuali, timestamp completi, cookie,
identificativi, IP, user-agent o referrer. È leggibile esclusivamente dal ruolo
server `service_role`; `anon` e `authenticated` non hanno grant o policy. Le
dimensioni campagna sono allowlistate nel codice e nello schema, così input
anonimo arbitrario non può creare un numero illimitato di bucket. Prima della
RPC, tutte le richieste condividono inoltre un unico limite globale di 60
incrementi al minuto (distribuito tramite Upstash quando configurato, con
fallback per istanza): sotto abuso la misura viene campionata, il redirect no.

## Report delle ultime 72 ore

Eseguire la query seguente con un client amministrativo autorizzato. Il report
raggruppa per giorno, asset e campagna; non usare la chiave service role nel
browser o nei log.

```sql
SELECT
  substring(ts_hour FROM 1 FOR 10) AS day_utc,
  slug,
  utm_source,
  utm_medium,
  utm_campaign,
  sum(n) AS clicks
FROM public.download_clicks
WHERE ts_hour >= to_char(timezone('UTC', now()) - interval '72 hours', 'YYYY-MM-DD"T"HH24')
GROUP BY day_utc, slug, utm_source, utm_medium, utm_campaign
ORDER BY day_utc, slug, utm_source, utm_medium, utm_campaign;
```
