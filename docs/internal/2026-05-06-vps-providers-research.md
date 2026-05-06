# 2026-05-06 — VPS providers per JHT: research e prezzi attuali

## TL;DR

Il primo smoke test su VPS gira su **Hetzner CPX22** (€9.75/mo, 4GB / 2vCPU AMD EPYC / 80GB SSD,
Norimberga). Scelto per familiarita' della piattaforma e hardware AMD nuovo —
non per essere il piu' economico in assoluto.

Per chi ottimizza sul prezzo a parita' di stabilita' CPU, **Netcup VPS 500 G12**
(€5.91/mo, 4GB DDR5 ECC, AMD EPYC 9634, mensile) e' la migliore alternativa.

Da evitare per JHT: **Contabo** (CPU oversold rompe la calibrazione di Bridge V6/V7),
**V6Node** (no IPv4 default, complica SSH).

## Perche' questa research e' rilevante

Il modo VPS e' la modalita' ⭐ "target setup" della vision JHT (vedi
`docs/about/VISION.md` e `BACKLOG.md` § PHASE 1). Quando un utente
non-tech segue il quickstart e arriva al bivio "PC locale vs PC dedicato
vs VPS", deve avere indicazioni concrete sul costo reale di ogni
provider. Le cifre approssimative ("circa €5/mese") nei doc sono
fuorvianti: i listini cambiano spesso e la differenza tra €4 e €10 e'
significativa per chi sta decidendo se provare JHT.

Questa research feeda il task `[JHT-VPS-COMPARISON-DOC]` in PHASE 1
(BACKLOG riga 248-256).

## Tabella comparativa (2026-05-06)

Tutti i prezzi includono VAT EU (22% IT, 19% DE). RAM 4 GB target per
JHT con 8 agents + Next.js dev + Sentinella + Bridge.

| Provider                   | Plan              | vCPU                 | RAM          | Storage     | €/mo  | Contratto | EU? | Note critiche                              |
|----------------------------|-------------------|----------------------|--------------|-------------|-------|-----------|-----|---------------------------------------------|
| 🇩🇪 Hetzner                | CX23              | 2 mix Intel/AMD      | 4 GB         | 40 GB       | €3.99 | mensile   | ✅  | "Limited availability", HW vecchio          |
| 🇩🇪 Contabo                | Cloud VPS 10      | 4 AMD EPYC (oversold)| 8 GB         | 75 GB NVMe  | €4    | 12 mesi   | ✅  | ⚠️ CPU oversold, vincolo annuale            |
| 🇫🇷 V6Node                 | base              | 2                    | 4 GB         | 40 GB NVMe  | €4.49 | mensile   | ✅  | ⚠️ NO IPv4 default (proxy), complica SSH    |
| 🇩🇪 **Netcup ⭐**          | **VPS 500 G12**   | **2 AMD EPYC 9634**  | **4 GB DDR5 ECC** | NVMe   | **€5.91** | mensile | ✅  | DDR5 ECC, hardware top tier             |
| 🇫🇷 OVHcloud               | VPS-1             | 4                    | 8 GB         | 75 GB SSD   | ~€6   | mensile   | ✅  | Backup giornalieri inclusi                  |
| 🇩🇪 Hetzner                | **CPX22**         | 2 AMD EPYC nuovi     | 4 GB         | 80 GB SSD   | €7.99 (€9.75 incl IPv4 €0.61 + VAT IT) | mensile | ✅ | Scelto per primo smoke 2026-05-06       |
| 🇩🇪 Netcup                 | VPS 1000 G12      | 4 AMD EPYC 9634      | 8 GB DDR5 ECC| 256 GB NVMe | €10.37| mensile   | ✅  | Tier ottimale per job-hunt continuativo     |

> ⚠️ **Hetzner ha alzato i prezzi il 1 aprile 2026**: CPX22 e' passato da
> €5.99 a €7.99/mo. Il valore mostrato in console.hetzner.com include
> IPv4 (€0.61/mo) + VAT, da cui i €9.75/mo visti durante la creazione.

## Considerazioni JHT-specific

### Stabilita' CPU vs Bridge V6/V7

Il Bridge (`shared/skills/sentinel-bridge.py` o equivalente runtime)
calibra la velocita' del team basandosi sul **throughput in tempi di
risposta degli agenti**. Su VPS con CPU oversold (Contabo) o hardware
mixed (Hetzner CX line) il rumore di throughput rende la calibrazione
imprecisa: la projection oscilla del 20-30% invece del 5% atteso.

Risultato: Sentinella interviene piu' spesso, Bridge non sa stabilizzare,
finestra rate budget gestita male.

**Implicazione**: per JHT, **CPU prevedibile** vale piu' di "RAM nominale
piu' grossa". Un 4GB AMD EPYC stabile batte un 8GB AMD oversold.

### RAM 4GB sufficiente?

Misurato 2026-05-06 in WSL Ubuntu 22.04 con immagine GHCR del 27/4:
container `jht` con `dashboard --no-browser` PID 1, idle, ~700 MB RSS.
Con 8 agents tmux attivi, ognuno fa partire un Claude Code/Kimi/Codex
che e' il vero memory hog (~200-400 MB RSS per agente).

**Stima total RAM workload**:
- container infra (Next.js + node): ~700 MB
- 8 agents tmux + CLI provider: ~2.5 GB (~310 MB ciascuno)
- Sentinella + Bridge: ~150 MB
- buffer kernel/cache: ~600 MB
- **TOTAL ~3.9 GB su 4 GB disponibili → 98%**

A 4GB siamo **al limite**. Con CPX22 (4GB) ci si sta solo se non gira
nient'altro sul VPS. Se l'utente vuole anche tunnel Tailscale, log
collector, monitoring agent, **8GB e' la scelta saggia long-term** (Netcup
VPS 1000 G12 €10.37/mo, oppure Hetzner CPX32 €17.07/mo).

Per il **primo smoke test** (durata ~1-2 settimane, validare design
host/container split end-to-end), 4GB bastano: l'obiettivo non e' il
job-hunt continuativo ma verificare che il flow funzioni.

### GDPR & data residency

Tutti i provider EU listati sono coperti dal GDPR. Hetzner (DE),
Netcup (DE), OVHcloud (FR), Contabo (DE) processano i dati in EU.
Per VPS USA evitare AWS/GCP/DO se i candidati che JHT analizza sono
EU residents (i loro CV passano per il VPS).

Vedi anche feedback `feedback_no_frankfurt_in_docs.md` — la regione
Supabase (Frankfurt) NON va menzionata nei doc pubblici, solo in
GDPR/compliance doc dedicato.

### Network / traffic

Tutti i provider listati offrono 20+ TB di traffic mensile incluso.
JHT consuma ~ 5 GB/mese (web scraping + LLM API + Telegram), praticamente
zero. Non serve cercare offerte "unlimited bandwidth".

### Backup

Hetzner Backup costa €1.10/mo extra (skip per smoke test).
OVHcloud include backup giornalieri di default.
Per JHT, lo stato persistente sta su `~/.jht/` host-side: snapshot Hetzner
(€0.012/GB/mo, ~€1/mo per uno snapshot manuale del disk completo) e'
piu' utile dei backup automatici, perche' permette il flow "Snapshot +
delete server" del design `2026-05-04-vps-deployment-design.md` (riga
208 — ferma la fattura durante vacanze, conserva i dati).

## Provider deep-dive

### 🇩🇪 Hetzner Cloud — scelto per primo smoke

**Pro:**
- Hardware AMD EPYC nuovo (CPX line)
- Console pulita, API ben documentata
- Snapshot + delete server pattern supportato (~€1/mo per backup snapshot)
- DC Norimberga / Falkenstein / Helsinki / Ashburn / Hillsboro / Singapore
- Riferimento per i task `[JHT-CLOUD-04]` e `[JHT-VPS-FRIENDLY]` in PHASE 3

**Contro:**
- CX line ("Cost-Optimized") oggi e' "Limited availability" — phase-out
  in corso. Evitare per ambienti long-running.
- Rincaro 2026: CPX22 €5.99 → €7.99/mo (+33%)

**Tier raccomandato:** CPX22 (smoke / primo test) o CPX32 (€17.07/mo,
8GB / 4 vCPU AMD) per job-hunt continuativo.

### 🇩🇪 Netcup — best alternative

**Pro:**
- VPS 500 G12 (€5.91/mo): 4GB DDR5 ECC, AMD EPYC 9634 (top server-grade
  CPU), NVMe, mensile
- VPS 1000 G12 (€10.37/mo): 8GB DDR5 ECC, 4 vCPU, 256GB NVMe — best
  long-term spot
- DDR5 con ECC = memoria server-grade, no errori silenti
- DC Norimberga, GDPR ok
- Mensile, no vincolo annuale

**Contro:**
- UI tedesca/inglese a tratti meno polished di Hetzner
- API meno ricca per provisioning programmatico (impatta `[JHT-CLOUD-04]`
  Hetzner adapter — un eventuale Netcup adapter andrebbe valutato a parte)

**Tier raccomandato:** VPS 500 G12 (smoke), VPS 1000 G12 (continuativo).

### 🇩🇪 Contabo — non raccomandato per JHT

**Pro apparenti:**
- Cloud VPS 10 a €4/mo con 8GB RAM + 4 vCPU AMD EPYC
- Sembra il deal del secolo

**Contro reali:**
- ⚠️ CPU oversold pesantemente: durante picchi gli vCPU sono condivisi 4-6x
  rispetto alla nominale. [VPSBenchmarks 2026](https://www.vpsbenchmarks.com/compare/contabo_vs_netcup)
  mostra Netcup VPS 4000 con fio scores 2x rispetto a Contabo equivalenti.
- ⚠️ Contratto **12 mesi vincolante** — non si esce
- ⚠️ Bridge V6/V7 calibration **non funziona** con CPU oscillanti

**Verdetto:** evitare per JHT, anche se i numeri di pricing sembrano
imbattibili. Sentinella diventa instabile e l'utente avra' un'esperienza
frustrante.

### 🇫🇷 OVHcloud — interessante per backup-included

**Pro:**
- VPS-1 ~€6/mo con 4 vCPU + 8GB + 75GB SSD + backup giornaliero incluso
- Anti-DDoS incluso
- Mensile

**Contro:**
- API meno snella di Hetzner
- Performance benchmark mediocri rispetto a Hetzner CPX / Netcup VPS

**Tier raccomandato:** VPS-1 se il backup giornaliero ha valore percepito
(es. utente preoccupato di perdere dati durante il job hunt).

### 🇫🇷 V6Node — niche, no IPv4 default

**Pro:**
- €4.49/mo per 4GB / 2 vCPU / 40GB NVMe
- Cheap

**Contro:**
- Niente IPv4 dedicato by default (solo proxy reverse)
- Setup SSH richiede tunnelling extra
- **Non adatto per JHT setup standard** (`install.sh` assume IPv4 raggiungibile)

**Verdetto:** skip.

## Decision matrix

```
                                 ┌──────────────────────────────┐
                                 │  Pesa il prezzo o la stabilita'? │
                                 └──────────────┬───────────────┘
                                                │
                       ┌────────────────────────┴────────────────────────┐
                       │                                                  │
                       ▼                                                  ▼
              "Voglio testare JHT                              "Voglio JHT in produzione
               1-2 settimane,                                   per il job hunt vero,
               costo ridotto"                                   1-3 mesi continuativi"
                       │                                                  │
                       ▼                                                  ▼
              Netcup VPS 500 G12                                  Netcup VPS 1000 G12
              €5.91/mo, 4GB                                        €10.37/mo, 8GB
                       │                                                  │
                       │                                                  │
              Alternative buone:                                  Alternative buone:
              - Hetzner CPX22 €9.75       ← scelta del primo      - Hetzner CPX32 €17.07
                (familiarita' platform)      smoke 2026-05-06     - OVHcloud VPS-2 ~€10
                                                                    (backup incluso)

              Da evitare:
              - Contabo (CPU oversold)
              - V6Node (no IPv4)
              - Hetzner CX line (limited avail.)
```

## Sources

- [Hetzner Cloud pricing](https://www.hetzner.com/cloud/) (2026-05-06)
- [Netcup VPS plans](https://www.netcup.com/en/server/vps) (2026-05-06)
- [Contabo Cloud VPS](https://contabo.com/en/vps/) (2026-05-06)
- [OVHcloud VPS](https://www.ovhcloud.com/en/vps/) (2026-05-06)
- [VPSBenchmarks: Contabo vs Netcup](https://www.vpsbenchmarks.com/compare/contabo_vs_netcup)
- [Top 11 Hetzner Alternatives — DigitalOcean](https://www.digitalocean.com/resources/articles/hetzner-alternatives)
- [7 Best Hetzner Alternatives 2026 — WebsitePlanet](https://www.websiteplanet.com/blog/best-hetzner-alternatives/)
- [Hetzner Cloud Review 2026 — BetterStack](https://betterstack.com/community/guides/web-servers/hetzner-cloud-review/)
- [Cheap VPS 2026 — EXPERTE.com](https://www.experte.com/server/cheap-vps)

## Riferimenti interni

- `BACKLOG.md` § PHASE 1 `[JHT-VPS-VALIDATE]` (smoke su VPS reale)
- `BACKLOG.md` § PHASE 1 `[JHT-VPS-COMPARISON-DOC]` (questo doc lo feeda)
- `docs/internal/2026-05-04-vps-deployment-design.md` (lifecycle a 3 livelli, gotcha Hetzner billing)
- `docs/internal/2026-05-06-host-container-split.md` (design install.sh ridisegnato)
- `docs/internal/2026-05-01-bridge-and-token-monitoring.md` (perche' CPU stabile conta per la calibrazione)
