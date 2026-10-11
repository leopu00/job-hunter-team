# Download funnel: report aggregato

La rotta pubblica `/go/<slug>` incrementa soltanto bucket orari anonimi. La
tabella non contiene eventi individuali, timestamp completi, cookie,
identificativi, IP, user-agent o referrer. È leggibile esclusivamente dal ruolo
server `service_role`; `anon` e `authenticated` non hanno grant o policy. Le
dimensioni campagna sono allowlistate nel codice e nello schema, così input
anonimo arbitrario non può creare un numero illimitato di bucket. Prima della
RPC, tutte le richieste condividono inoltre un unico limite globale di 60
incrementi al minuto tramite Upstash. Se il coordinatore non è configurato o
non risponde, la misura fallisce chiusa e la RPC viene saltata: il redirect
continua comunque. Le variabili server richieste sono
`UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`.

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

## Windows desktop hotfix distribution

`web/lib/download-funnel.ts` owns the active artifact URL, desktop version,
filename, size, SHA-256, source commit, engine and runtime baseline. The
page and setup guide use the same `/go/<slug>` redirects and display each
artifact's own metadata. Site/runtime version and the GitHub latest-release
endpoint are separate; they must not be bumped to label a Windows hotfix.

Preparation keeps all four Godot 0.3.9 artifacts pinned to their versioned
URLs, with size and SHA-256 from the release asset metadata. This is not a
new functional retest. This is the preceding distribution, **not a known-good
fallback**: its Windows installer has the known bootstrap root ACL failure.
There is no `latest` fallback or environment activation flag.

The tested Windows 0.3.10 installer is
`job-hunter-team-windows-x64-setup.exe`, 295179599 bytes, SHA-256
`abd5a07362e09bd22c4c4995bb55147bf362e3b3252ca35ab2f987f8cd01146a`, from
source `450945129f025a25d18adfd72c1da65b7ec4d319` (base
`8227b1cb0158e631d78542c8c75f09ac2b7b9ea9`, fix
`c03add105b9d189928882072d1cd64f377634207`). Native ACL causality and G3
installer RESUME passed on those bytes. This does not attest portable 0.3.10,
G4, runtime changes or Internet SmartScreen behavior. Portable, macOS and
Linux remain on their separate 0.3.9 artifacts.

The selected distribution is a **separate Windows desktop-only GitHub
Release**, tag `desktop-windows-v0.3.10` pointing to source `450945129…`.
R2 and additions to the existing 0.3.9 release are not selected. Existing
0.3.9 assets, tag, checksums, provenance and strict audit remain unchanged.
The new download filename is
`job-hunter-team-windows-x64-setup-0.3.10.exe`; renaming the downloaded copy
does not change its approved bytes or installed product names.

Prepare it as a draft with `prerelease=true` and `make_latest=false`, audit
the exact three downloaded draft assets with
`scripts/desktop_release_audit.py`, then obtain the publication gate. The
prerelease flag scopes this distribution away from full-product/runtime
updates; it does not replace the Windows tester's result. See the separate
desktop-only procedure in [release.md](release.md). No draft, public URL or
0.3.10 active entry is implied by this preparation. EXEs stay outside Git.

Activation, after the hosting contract and verification of the public copy:

1. Record the permanent HTTPS URL and verify the copied bytes against the
   tested SHA-256 and size. The server must deliver the installer filename
   above (`Content-Disposition: attachment`) and `application/octet-stream`.
   Its immutable path must be under
   `/releases/download/desktop-windows-v0.3.10/`, after draft readback and
   publication verification. Verify GitHub `/releases/latest` still selects
   the full-product release and exposes its unchanged runtime manifest.
2. Replace the **complete `win-setup` entry** with the confirmed URL, version
   `0.3.10`, filename, hash, size and source commit above, engine `Godot`,
   runtime baseline `0.3.9`. Leave all other entries unchanged.
3. Update the expected active installer identity in the funnel test and run
   the funnel, download-page and seven-language guide tests plus the cloud
   web build through the shared build queue. Verify GET/HEAD 302 and
   `Cache-Control: no-store`; page and guide must show the same byte identity.
4. An independent reviewer must issue a written favorable verdict on the exact
   activation commit SHA before it is pushed. Deployment requires explicit
   authorization after the hosting, copied-byte and rollout checks above pass;
   the integrator coordinates execution without replacing either gate.

Withdrawal is explicit: replace the entire `win-setup` entry with `null`.
This removes its CTA and metadata from both page and guide, displays a
seven-language unavailable message, and returns GET/HEAD 503 with
`Cache-Control: no-store`, no `Location`, and no download increment. Do not
redirect automatically to 0.3.9. The independent portable link stays 0.3.9;
its presence is not an installer recovery claim. Preserve published bytes for
audit; retaining an asset does not reactivate a withdrawn site download.
