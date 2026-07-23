// [JHT-WEB-DEMO] Seed posizioni demo — persona "software" (56 posizioni).
// File generato: per rigenerarlo si passa dai JSON dello sciame di
// arricchimento e dal converter (23/07); a mano si edita come un normale
// array TS. L'ORDINE determina id/legacy_id: aggiungere solo in coda.
import type { Seed } from "../data";

export const SOFTWARE: Seed[] = [
  {
    title: "Senior Frontend Engineer",
    company: "Northstar Labs",
    city: "berlin",
    remote: "full_remote",
    sal: [78000, 96000, "EUR"],
    source: "LinkedIn",
    status: "ready",
    score: 91,
    family: "Frontend",
    h: 6,
    critic: [8, "PASS"],
    jd: "Northstar Labs is a Series-B analytics platform for e-commerce merchants. You'll co-own the design system and the customer-facing React application inside a small, senior product squad that ships weekly, with strong ownership of DX and performance budgets.",
    jdFull:
      "Northstar Labs helps e-commerce merchants turn raw event data into revenue decisions. Our analytics platform serves over 400 mid-market brands, and the customer-facing dashboard is the product surface our users touch every single day.\n\nThe Role\nWe're looking for a Senior Frontend Engineer to take ownership of our design system and the core React application. You'll work inside a four-person product squad (2 engineers, 1 designer, 1 PM) with full autonomy over technical decisions and a weekly release cadence.\n\nWhat you'll do\n- Evolve our internal design system (Radix + Tailwind) used across three product surfaces\n- Own web performance budgets and Core Web Vitals across the dashboard\n- Pair closely with design on interaction details and accessibility\n- Mentor two mid-level engineers and run frontend architecture reviews\n- Ship incrementally behind feature flags with fast rollback\n\nWhat we offer\n- Full remote within EU timezones, with quarterly in-person gatherings\n- Salary range 78,000-96,000 EUR depending on level\n- Learning budget and a 4-day deep-work week once a month\n- Light on-call rotation (one week per month, business hours only)\n\nWe value engineers who write clearly, ship often, and care as much about the craft of the interface as about the business outcomes it drives.",
    req: [
      "5+ years of production React and TypeScript",
      "Experience building or maintaining a design system at scale",
      "Deep understanding of web performance (Core Web Vitals, profiling, bundle budgets)",
      "Comfort mentoring and doing architecture reviews",
      "English working proficiency, EU timezone overlap",
    ],
    pros: [
      "Stack perfettamente allineato al profilo (React/TS avanzato)",
      "Full remote EU con raduni trimestrali",
      "Range salariale sopra la media di mercato per il ruolo",
    ],
    cons: ["On-call leggero una settimana al mese"],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 5+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo Senior Frontend molto centrato su React/TypeScript e design system, esattamente il terreno dove il candidato ha piu' storico. Azienda Series-B con recensioni positive e range salariale sopra la mediana per posizioni simili viste finora. Nessun mismatch rilevante, verdetto GO forte.",
    scoreNotes:
      "Punteggio molto alto: stack, seniority e range salariale allineati quasi perfettamente al profilo, full remote EU senza barriere di visto.",
    criticNotes:
      "Round 1: 7/10, Round 2: 8/10, Round 3: 8/10. Verdict: PASS. Strength: solido storico su design system e performance, esempi concreti di ownership tecnica. Gap: nessuna menzione diretta di mentoring formale nel CV, aggiunta una riga a supporto senza inventare claim.",
  },
  {
    title: "Full Stack Product Engineer",
    company: "AtlasCare",
    city: "milano",
    remote: "hybrid",
    sal: [58000, 74000, "EUR"],
    source: "Wellfound",
    status: "ready",
    score: 84,
    family: "Full-stack",
    h: 12,
    critic: [7, "PASS"],
    jd: "AtlasCare is a healthtech scale-up building patient-facing tools for chronic care management. You'll own end-to-end feature work across a Next.js frontend and a Node/Postgres backend, working two days a week from the Milan office alongside product and clinical advisors.",
    jdFull:
      "AtlasCare builds digital tools that help patients with chronic conditions stay on top of therapy plans between doctor visits. Our platform is used by over 40 clinics across Italy, and we're growing the engineering team to support new partnerships.\n\nThe Role\nAs a Full Stack Product Engineer you'll take features from design handoff to production, working across our Next.js frontend and Node/Postgres backend. You'll partner directly with a product manager and a clinical advisor to make sure what we ship actually helps patients.\n\nResponsibilities\n- Build and ship patient-facing features end-to-end\n- Design REST APIs and Postgres schemas for new modules\n- Participate in a lightweight on-call rotation for production issues\n- Contribute to technical decisions in a small, senior team\n\nWhat we offer\n- Hybrid setup, two days a week in our Milan office near Porta Romana\n- Salary range 58,000-74,000 EUR based on experience\n- Private health insurance and mental health support\n- Direct exposure to a product with real clinical impact\n\nWe're a team of 18, mostly engineers with healthcare or fintech backgrounds. Italian and English are both used daily in meetings and documentation.",
    req: [
      "3+ years full-stack experience with Node.js and React/Next.js",
      "Solid Postgres and REST API design skills",
      "Comfortable working in a regulated/healthcare-adjacent domain",
      "Italian and English fluency",
      "Based in or willing to commute to Milan twice a week",
    ],
    pros: [
      "Prodotto con impatto concreto sul paziente",
      "Ufficio a 20 minuti dal centro, hybrid gestibile",
      "Team piccolo e senior, decisioni rapide",
    ],
    cons: ["Ibrido vincolante 2 giorni/settimana"],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Italian + English\n\nRuolo full-stack coerente con lo storico del candidato su Node/React, dominio healthtech nuovo ma adiacente a esperienze precedenti su prodotti regolamentati. Ibrido a Milano compatibile con la posizione dichiarata. Verdetto GO.",
    scoreNotes:
      "Punteggio alto: fit tecnico solido su Node/Postgres/React, stipendio in linea col mercato milanese per un mid-senior, unico limite l'ibrido vincolante.",
    criticNotes:
      "Round 1: 6.5/10, Round 2: 7/10, Round 3: 7/10. Verdict: PASS. Strength: esperienza end-to-end su feature complete ben documentata nel CV. Gap: nessun progetto healthcare pregresso, colmato enfatizzando l'esperienza su prodotti regolamentati fintech.",
    addr: "Via Orti 14, 20122 Milano",
  },
  {
    title: "Platform Engineer, Kubernetes",
    company: "GreenGrid",
    city: "amsterdam",
    remote: "full_remote",
    sal: [80000, 105000, "EUR"],
    source: "Otta",
    status: "ready",
    score: 88,
    family: "DevOps / Cloud",
    h: 20,
    critic: [8, "PASS"],
    jd: "GreenGrid runs the software platform behind a distributed renewable-energy trading network. You'll own the multi-tenant Kubernetes platform on AWS that serves 60 engineers, focusing on cluster lifecycle, observability and developer tooling.",
    jdFull:
      "GreenGrid operates a real-time trading platform connecting renewable energy producers with grid operators across Northern Europe. Reliability and observability aren't nice-to-haves here — a platform incident has direct financial consequences for our customers.\n\nThe Role\nWe're hiring a Platform Engineer to own our multi-tenant Kubernetes platform on AWS, serving roughly 60 product engineers across 12 teams. You'll be the go-to person for cluster lifecycle, GitOps workflows and the developer tooling that sits on top.\n\nWhat you'll do\n- Manage cluster upgrades, scaling and multi-tenancy policies (namespaces, quotas, network policies)\n- Build and maintain GitOps pipelines (ArgoCD) and Terraform modules for infra provisioning\n- Improve observability: tracing, metrics, alerting and on-call runbooks\n- Write internal tooling in Go or Python to reduce toil for product teams\n- Participate in a paid on-call rotation\n\nWhat we offer\n- Full remote, EU timezone overlap expected (UTC-1 to UTC+3 roughly)\n- Salary range 80,000-105,000 EUR\n- 3,000 EUR/year learning and conference budget\n- Home office stipend and a yearly team offsite\n\nOur platform team is currently four people; you'd be the fifth, with real influence over how we evolve the platform over the next two years.",
    req: [
      "Production experience running and scaling Kubernetes clusters",
      "Strong IaC background (Terraform) and GitOps workflows (ArgoCD/Flux)",
      "Golang or Python for internal tooling",
      "Solid observability practice (Prometheus, Grafana, tracing)",
      "Comfortable with paid on-call rotations",
    ],
    pros: [
      "Team platform maturo, on-call pagato e ben strutturato",
      "Budget formazione 3k/anno",
      "Stipendio tra i piu' alti visti per il ruolo",
    ],
    cons: ["Timezone spread ampio (UTC-5 -> UTC+2)"],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 4+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nPiattaforma Kubernetes multi-tenant su AWS, esattamente l'area di maggiore forza del candidato (Terraform, GitOps, osservabilita'). Azienda energy-tech con recensioni solide. On-call pagato, un plus rispetto a posizioni simili scartate in precedenza.\nNOTE_MISMATCH: [GEO] Team distribuito su fusi molto ampi, possibile overlap ridotto con alcuni colleghi US-based.",
    scoreNotes:
      "Punteggio alto: competenze Kubernetes/Terraform/GitOps quasi 1:1 col profilo, stipendio sopra media, unico neo lo spread di fuso orario.",
    criticNotes:
      "Round 1: 7/10, Round 2: 8/10, Round 3: 8/10. Verdict: PASS. Strength: esperienza concreta su GitOps e multi-tenancy ben rappresentata. Gap: tooling in Go limitato nel CV, bilanciato mostrando solidita' su Python.",
  },
  {
    title: "Machine Learning Engineer",
    company: "SignalForge",
    remote: "full_remote",
    sal: [95000, 130000, "USD"],
    source: "Hacker News",
    status: "ready",
    score: 86,
    family: "AI / ML",
    h: 28,
    critic: [7, "PASS"],
    jd: "SignalForge builds anomaly-detection models for industrial IoT sensor networks. You'll work on time-series ML end-to-end — from feature pipelines on Spark to model serving on Kubernetes — inside a small, remote-first applied ML team.",
    jdFull:
      "SignalForge sells predictive-maintenance software to manufacturing plants, using sensor data to catch equipment failures days before they happen. Our models run in production at over 50 industrial sites worldwide.\n\nThe Role\nWe're looking for a Machine Learning Engineer to own applied ML on time-series anomaly detection. This is a full end-to-end role: you'll touch feature pipelines, model training, and production serving.\n\nResponsibilities\n- Build and maintain feature pipelines on Spark for high-frequency sensor data\n- Train and iterate on PyTorch models for anomaly detection and forecasting\n- Deploy and monitor models served on Kubernetes, with drift detection\n- Collaborate with domain experts to validate model outputs against real failures\n- Contribute to our internal ML platform tooling\n\nWhat we offer\n- Fully remote, no EU office, async-first culture\n- Salary 95,000-130,000 USD depending on experience\n- Home office budget and a yearly all-hands offsite\n- Small team (9 ML engineers), high ownership from day one\n\nRequirements\n- Strong Python and PyTorch background\n- Track record of shipping models to production, not just notebooks\n- Comfort with distributed data processing (Spark or equivalent)\n\nOur interview process has five steps: intro call, take-home, two technical interviews, and a final culture chat with the team.",
    req: [
      "Strong Python and PyTorch for production ML",
      "Experience shipping models to production, not just research",
      "Comfort with distributed data pipelines (Spark or similar)",
      "Familiarity with model serving and monitoring on Kubernetes",
      "Ability to work async across US and EU timezones",
    ],
    pros: [
      "Progetti ML end-to-end, non solo notebook",
      "Compenso in USD sopra range per il ruolo",
    ],
    cons: [
      "Colloqui in 5 step, processo lungo",
      "Azienda remota senza sede EU",
    ],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 4+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo ML applicato con enfasi su produzione, non ricerca pura: buon match con lo storico del candidato su pipeline dati e deploy modelli. Assenza di sede EU non e' un blocco data la natura full remote, ma va segnalata come nota geografica.\nNOTE_MISMATCH: [GEO] Nessuna sede EU, cultura fortemente US-centrica; overlap orario da verificare in colloquio.",
    scoreNotes:
      "Punteggio alto: stack PyTorch/Spark e cultura di deploy in produzione allineati bene, compenso in USD generoso; il processo di selezione lungo pesa leggermente.",
    criticNotes:
      "Round 1: 6/10, Round 2: 7/10, Round 3: 7/10. Verdict: PASS. Strength: esperienza dimostrata di deploy modelli in produzione, non solo prototipazione. Gap: uso di Spark meno documentato, colmato citando esperienza equivalente su pipeline distribuite.",
  },
  {
    title: "Backend Engineer, Payments",
    company: "FinPilot",
    city: "amsterdam",
    remote: "hybrid",
    sal: [70000, 88000, "EUR"],
    source: "LinkedIn",
    status: "applied",
    score: 82,
    family: "Backend",
    h: 80,
    critic: [8, "PASS"],
    jd: "FinPilot runs core payments infrastructure for European merchants. You'll build high-throughput services in Kotlin on an event-driven architecture over Kafka, inside a team with a strict correctness and testing culture given the regulatory stakes.",
    jdFull:
      "FinPilot processes payments for thousands of European merchants, handling everything from authorization to settlement. Correctness isn't optional in this domain — every service change goes through rigorous review and testing.\n\nThe Role\nWe're expanding our Payments team with a Backend Engineer who'll build and maintain high-throughput Kotlin services on an event-driven architecture backed by Kafka. You'll work closely with compliance and risk teams to make sure every edge case is handled correctly.\n\nWhat you'll do\n- Design and implement payment processing services in Kotlin\n- Work with Kafka for event sourcing and inter-service communication\n- Write extensive automated tests, including contract and chaos tests\n- Participate in incident response and postmortems\n- Collaborate with compliance on PSD2 and local payment regulations\n\nWhat we offer\n- Hybrid model, two to three days a week at our Amsterdam office\n- Salary range 70,000-88,000 EUR\n- Strong onboarding and pairing culture for the first three months\n- Relocation support for candidates moving to the Netherlands\n\nWe look for engineers who are comfortable with ambiguity but obsessive about correctness once the requirements are clear. Dutch is not required; English is our working language.",
    req: [
      "4+ years backend experience, ideally with Kotlin or Java",
      "Experience with event-driven architectures and Kafka",
      "Strong testing discipline (unit, contract, integration)",
      "Comfort working in a regulated, high-stakes domain",
      "Willing to work hybrid from Amsterdam",
    ],
    pros: [
      "Dominio fintech con standard di qualita' molto alti",
      "Stipendio in linea con senior nel settore payments",
      "Relocation support disponibile",
    ],
    cons: ["Cultura di test molto rigida, curva di adattamento iniziale"],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 4+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo backend payments su Kotlin/Kafka, area in cui il candidato ha gia' esperienza diretta su sistemi event-driven. Azienda con reputazione solida (Glassdoor 4.0) e cultura di correttezza molto marcata, coerente con il profilo orientato alla qualita'. Verdetto GO.",
    scoreNotes:
      "Punteggio alto: Kotlin/Kafka e dominio payments ben coperti dallo storico, stipendio adeguato al livello, ibrido gestibile con relocation support.",
    criticNotes:
      "Round 1: 7/10, Round 2: 8/10, Round 3: 8/10. Verdict: PASS. Strength: esperienza diretta su architetture event-driven ben evidenziata nel CV, con esempi concreti su Kafka. Gap: nessuna esperienza specifica PSD2 documentata, gestita mettendo in risalto l'attenzione generale a compliance e testing.",
    addr: "Herengracht 182, 1016 BR Amsterdam",
  },
  {
    title: "Software Engineer, Data Platform",
    company: "Mosaic Cloud",
    city: "paris",
    remote: "hybrid",
    sal: [68000, 85000, "EUR"],
    source: "Welcome to the Jungle",
    status: "applied",
    score: 79,
    family: "Data",
    h: 110,
    critic: [7, "PASS"],
    jd: "Mosaic Cloud builds a customer data platform used by mid-market retailers to unify behavioral and transactional data. You'll build the ingestion and transformation layer on Airflow, dbt and BigQuery, working two days a week from the Paris office.",
    jdFull:
      "Mosaic Cloud helps retailers unify customer data scattered across e-commerce, POS and marketing tools into a single queryable platform. Our ingestion layer handles several billion events per month.\n\nThe Role\nAs a Software Engineer on the Data Platform team, you'll build and maintain the ingestion and transformation pipelines that power our customer data platform: Airflow for orchestration, dbt for transformations, BigQuery as the warehouse.\n\nResponsibilities\n- Design and maintain Airflow DAGs for ingestion from 30+ source connectors\n- Write and review dbt models with strong testing coverage\n- Optimize BigQuery cost and query performance\n- Partner with the analytics team on data contracts and schema changes\n- Participate in on-call for pipeline failures\n\nWhat we offer\n- Hybrid, two days a week at our Paris office near Republique\n- Salary range 68,000-85,000 EUR\n- Meal vouchers and full health coverage\n- Small, senior team (6 data engineers)\n\nWe're looking for someone pragmatic who cares about data quality as much as pipeline throughput. French is appreciated but not required; the team works in English.",
    req: [
      "3+ years building data pipelines (Airflow or equivalent orchestrator)",
      "Strong SQL and dbt modeling experience",
      "Familiarity with BigQuery or another cloud data warehouse",
      "Comfort owning data quality and testing for pipelines",
      "English fluency, French a plus",
    ],
    pros: [
      "Stack dbt/BigQuery molto vicino all'esperienza pregressa",
      "Team piccolo e senior con forte focus su data quality",
    ],
    cons: [
      "Ibrido 2 giorni/settimana a Parigi",
      "On-call su pipeline, orari non sempre prevedibili",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English (French preferito)\n\nRuolo data engineering su stack Airflow/dbt/BigQuery praticamente sovrapponibile allo storico del candidato. Azienda con buone recensioni interne, ibrido gestibile con soggiorni brevi a Parigi. Verdetto GO.",
    scoreNotes:
      "Punteggio buono: stack quasi identico all'esperienza pregressa, stipendio nella media, penalizzato leggermente dall'ibrido e dall'on-call su pipeline.",
    criticNotes:
      "Round 1: 6.5/10, Round 2: 7/10, Round 3: 7/10. Verdict: PASS. Strength: modellazione dbt e gestione DAG Airflow documentate con esempi concreti. Gap: nessuna esperienza diretta su BigQuery, mitigata evidenziando esperienza equivalente su Snowflake.",
  },
  {
    title: "React Native Developer",
    company: "Loopway",
    city: "barcelona",
    remote: "full_remote",
    sal: [52000, 68000, "EUR"],
    source: "Wellfound",
    status: "response",
    score: 77,
    family: "Mobile",
    h: 160,
    critic: [7, "PASS"],
    jd: "Loopway operates a consumer mobility app with 2M monthly active users across Southern Europe. You'll build and maintain the React Native app, writing native modules when the JS bridge isn't enough, inside a small, fully remote mobile team.",
    jdFull:
      "Loopway lets people rent scooters, bikes and cars across a dozen European cities from a single app. With 2M monthly active users, small performance and UX issues have an outsized impact.\n\nThe Role\nWe need a React Native Developer to join our mobile team of five. You'll work across the whole app — from booking flows to real-time vehicle tracking — and drop into native Swift/Kotlin modules when needed.\n\nWhat you'll do\n- Build and maintain features in React Native + TypeScript\n- Write native modules (Swift/Kotlin) for camera, maps and Bluetooth lock integration\n- Profile and fix performance issues on lower-end Android devices\n- Participate in release planning and app store submissions\n- Collaborate with backend team on API contracts\n\nWhat we offer\n- Fully remote, team distributed across Spain, Portugal and Italy\n- Salary range 52,000-68,000 EUR\n- Company-wide offsite twice a year\n- Free access to the Loopway fleet in all covered cities\n\nWe ship a new app version every two weeks and care deeply about performance on the low end of the Android device spectrum, since a large share of our users are outside major cities.",
    req: [
      "3+ years with React Native in production apps",
      "Comfort writing native modules in Swift or Kotlin",
      "Experience with performance profiling on mobile",
      "Familiarity with app store release processes",
      "Spanish, Italian or Portuguese a plus but not required",
    ],
    pros: [
      "App con base utenti reale e alto impatto (2M MAU)",
      "Full remote con team distribuito in Sud Europa",
      "Accesso gratuito alla flotta come benefit",
    ],
    cons: [
      "Cicli di rilascio serrati ogni due settimane",
      "Necessita' occasionale di scrivere codice nativo Swift/Kotlin",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo React Native su prodotto consumer ad alto traffico, coerente con lo storico mobile del candidato. Full remote senza barriere di visto, stipendio nella media per il mercato spagnolo/remoto EU.\nNOTE_MISMATCH: [STACK] Richiesta occasionale di moduli nativi Swift/Kotlin, esperienza del candidato principalmente lato JS bridge.",
    scoreNotes:
      "Punteggio buono: esperienza React Native solida e prodotto ad alto impatto, penalizzato leggermente dalla richiesta di moduli nativi non nel core skillset.",
    criticNotes:
      "Round 1: 6/10, Round 2: 7/10, Round 3: 7/10. Verdict: PASS. Strength: esperienza concreta su app consumer ad alto volume ben documentata. Gap: moduli nativi Swift/Kotlin poco presenti nel CV, non inventato nulla, evidenziata disponibilita' ad apprendere.",
  },
  {
    title: "TypeScript Engineer, DX Tools",
    company: "Brightline",
    city: "london",
    remote: "full_remote",
    sal: [70000, 90000, "GBP"],
    source: "Otta",
    status: "writing",
    score: 85,
    family: "Frontend",
    h: 30,
    wr: true,
    jd: "Brightline's developer-experience team builds the internal CLIs and CI tooling used daily by 300 engineers across the company. You'll design and ship the tools that make everyone else faster, working full remote with the DX team.",
    jdFull:
      "Brightline is a fast-growing enterprise software company with roughly 300 engineers across a dozen product teams. Our Developer Experience team exists to make all of them faster and happier, and we treat internal tooling with the same rigor as customer-facing product.\n\nThe Role\nAs a TypeScript Engineer on the DX Tools team, you'll design, build and maintain the internal CLIs, code generators and CI pipelines that every engineering team depends on.\n\nWhat you'll do\n- Build and maintain internal CLI tools in TypeScript/Node\n- Improve CI pipeline speed and reliability across dozens of repositories\n- Design developer-facing APIs and write documentation engineers actually read\n- Gather feedback from engineering teams and prioritize the DX roadmap\n- Occasionally pair with product teams adopting new tooling\n\nWhat we offer\n- Fully remote, UK-based team with occasional London meetups\n- Salary range 70,000-90,000 GBP\n- Strong internal tools culture, dedicated 20% time for tooling debt\n- Annual company offsite\n\nWe're looking for someone who gets genuine satisfaction from making other engineers' day-to-day easier, and who can balance building robust tools with shipping fast enough to stay useful.",
    req: [
      "4+ years TypeScript/Node.js experience",
      "Experience building internal developer tools or platform APIs",
      "Familiarity with CI/CD systems (GitHub Actions or similar)",
      "Strong written communication for documentation",
      "Based in the UK or EU with UK timezone overlap",
    ],
    pros: [
      "Ruolo di piattaforma con impatto trasversale su 300 ingegneri",
      "Full remote con stipendio GBP competitivo",
      "20% time dedicato al debito di tooling",
    ],
    cons: [
      "Team piccolo, priorita' che cambiano spesso in base al feedback interno",
    ],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 4+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo di developer experience su CLI e tooling interno, area meno frequentata dal candidato rispetto al frontend prodotto ma con forte overlap TypeScript/Node. Stipendio GBP sopra la mediana. Verdetto GO cauto, in scrittura CV con enfasi su progetti di tooling interno gia' realizzati.\nNOTE_MISMATCH: [DOMAIN] Ruolo orientato a developer tooling puro, il candidato ha piu' storico su prodotto customer-facing.",
    scoreNotes:
      "Punteggio buono-alto: stack TypeScript/Node solido, stipendio competitivo in GBP; il dominio DX tooling e' meno centrale nello storico del candidato rispetto al frontend prodotto.",
  },
  {
    title: "Site Reliability Engineer",
    company: "Nordwind",
    city: "stockholm",
    remote: "hybrid",
    sal: [62000, 80000, "EUR"],
    source: "LinkedIn",
    status: "writing",
    score: 74,
    family: "DevOps / Cloud",
    h: 44,
    wr: true,
    jd: "Nordwind operates critical infrastructure for a Nordic logistics network. You'll join the SRE team responsible for uptime, incident response and observability across a fleet of microservices, working hybrid from the Stockholm office.",
    jdFull:
      "Nordwind coordinates freight logistics across the Nordic countries, and our platform is the operational backbone that dispatchers and drivers rely on around the clock. Downtime has immediate real-world consequences.\n\nThe Role\nWe're looking for a Site Reliability Engineer to join our four-person SRE team. You'll own reliability practices across roughly 40 microservices, from alerting to capacity planning.\n\nResponsibilities\n- Define and maintain SLOs/SLIs across core services\n- Improve observability: dashboards, alerting, distributed tracing\n- Lead incident response and write blameless postmortems\n- Automate capacity planning and infra provisioning (Terraform)\n- Participate in a shared on-call rotation\n\nWhat we offer\n- Hybrid, two days a week from our Stockholm office\n- Salary range 62,000-80,000 EUR (or SEK equivalent)\n- Strong on-call compensation and rest-time policy\n- Yearly conference budget\n\nWe value calm, methodical engineers who can stay clear-headed during incidents and who care about writing runbooks that actually get used.",
    req: [
      "3+ years in SRE, DevOps or infrastructure roles",
      "Experience defining and tracking SLOs/SLIs",
      "Solid Terraform and infrastructure-as-code background",
      "Comfort leading incident response",
      "Willing to work hybrid from Stockholm",
    ],
    pros: [
      "Cultura di incident response matura e ben documentata",
      "Compenso on-call equo",
      "Ruolo con forte autonomia tecnica",
    ],
    cons: [
      "Ibrido a Stoccolma, trasferimento o pendolarismo da valutare",
      "Rotazione on-call condivisa su turni notturni",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo SRE su infrastruttura critica logistica, buon overlap con esperienza pregressa su osservabilita' e Terraform. Ibrido a Stoccolma da valutare per logistica personale. In scrittura CV con focus su incident response e SLO.\nNOTE_MISMATCH: [GEO] Richiesta presenza in ufficio a Stoccolma due giorni a settimana, verificare fattibilita' pendolarismo/relocation.",
    scoreNotes:
      "Punteggio discreto: competenze SRE core coperte bene, penalizzato dall'ibrido vincolante a Stoccolma e dal turno on-call condiviso.",
    addr: "Sveavagen 44, 111 34 Stockholm",
  },
  {
    title: "Data Engineer",
    company: "Pipebase",
    remote: "full_remote",
    sal: [60000, 82000, "EUR"],
    source: "Company site",
    status: "review",
    score: 78,
    family: "Data",
    h: 52,
    jd: "Pipebase builds ELT pipelines and enforces data contracts for a B2B SaaS analytics product. You'll own pipeline reliability end-to-end, working with dbt, Snowflake and Dagster inside a fully remote data team.",
    jdFull:
      "Pipebase provides embedded analytics for other SaaS companies, which means our data pipelines feed directly into our customers' own dashboards — reliability isn't optional.\n\nThe Role\nAs a Data Engineer, you'll build and maintain ELT pipelines and the data contracts that keep our customer-facing analytics trustworthy. Dagster orchestrates the pipelines, dbt handles transformations, and everything lands in Snowflake.\n\nWhat you'll do\n- Design and maintain Dagster pipelines ingesting from 20+ customer sources\n- Write and test dbt models with strong data contract enforcement\n- Monitor pipeline SLAs and investigate data quality incidents\n- Collaborate with customer-facing engineers on schema changes\n- Contribute to our internal data platform documentation\n\nWhat we offer\n- Fully remote, async-first, small team of 5 data engineers\n- Salary range 60,000-82,000 EUR\n- Flexible hours, core overlap only 4 hours a day\n- Annual team retreat\n\nWe're a small, opinionated team that prefers explicit data contracts over tribal knowledge, and we'd rather ship a smaller feature well-tested than a big one full of edge cases.",
    req: [
      "3+ years building ELT/ETL pipelines",
      "Strong dbt and SQL modeling experience",
      "Familiarity with Snowflake or another cloud warehouse",
      "Experience with an orchestrator (Dagster, Airflow or similar)",
      "Comfort working async in a fully remote team",
    ],
    pros: [
      "Stack dbt/Snowflake coerente con lo storico del candidato",
      "Full remote con orari flessibili",
      "Team piccolo, alta autonomia tecnica",
    ],
    cons: ["Overlap orario ridotto a sole 4 ore, coordinamento da verificare"],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo data engineering full remote con stack dbt/Snowflake molto vicino all'esperienza pregressa, Dagster nuovo ma con pattern simili ad Airflow gia' usato dal candidato. In revisione finale prima dell'invio.\nNOTE_MISMATCH: [STACK] Dagster mai usato direttamente, solo esperienza equivalente su Airflow.",
    scoreNotes:
      "Punteggio buono: stack dbt/Snowflake ben coperto, orchestratore diverso da quello usato in precedenza ma con pattern trasferibili; full remote e stipendio adeguati.",
  },
  {
    title: "Fullstack Engineer, Growth",
    company: "NovaPay",
    city: "dublin",
    remote: "hybrid",
    sal: [72000, 92000, "EUR"],
    source: "Wellfound",
    status: "review",
    score: 81,
    family: "Full-stack",
    h: 60,
    jd: "NovaPay is a fintech scaling its self-serve onboarding and growth loops. You'll work on the Growth engineering pod, shipping experiments across the Next.js frontend and Node backend, hybrid from the Dublin office.",
    jdFull:
      "NovaPay provides multi-currency business accounts to SMEs across Europe. Growth engineering here isn't just landing pages — it touches onboarding flows, pricing experiments and activation funnels that directly move the business.\n\nThe Role\nWe're hiring a Fullstack Engineer for our Growth pod. You'll run experiments end-to-end: instrumenting events, building the frontend and backend changes needed, and analyzing results with the growth PM.\n\nWhat you'll do\n- Ship A/B tests across onboarding and activation flows (Next.js + Node)\n- Instrument analytics events and maintain data quality for experiments\n- Collaborate closely with a growth PM and a data analyst\n- Contribute to the shared design system used across product teams\n- Participate in a light on-call rotation\n\nWhat we offer\n- Hybrid, three days a week at our Dublin office\n- Salary range 72,000-92,000 EUR\n- Equity package and private health insurance\n- Strong experimentation culture with fast iteration cycles\n\nWe move fast: most experiments ship within a sprint, and we kill or double down based on data within two weeks.",
    req: [
      "3+ years fullstack experience with Node.js and React/Next.js",
      "Experience running or supporting A/B tests and growth experiments",
      "Comfort with event instrumentation and analytics tooling",
      "Fintech or regulated-industry experience a plus",
      "Willing to work hybrid from Dublin",
    ],
    pros: [
      "Ruolo growth con impatto diretto e misurabile",
      "Stipendio sopra la media per Dublino",
      "Cultura di sperimentazione rapida e data-driven",
    ],
    cons: [
      "Tre giorni a settimana in ufficio, piu' vincolante di altri ibridi visti",
      "Contesto fintech regolamentato, tempi di review piu' lunghi su alcune feature",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo growth fullstack su stack Node/Next.js allineato allo storico del candidato, dominio fintech gia' incontrato in precedenti posizioni valutate. Ibrido tre giorni a settimana piu' vincolante della media, ma compensato da stipendio sopra mercato. In revisione finale.",
    scoreNotes:
      "Punteggio buono: stack e dominio ben coperti, penalizzato dai tre giorni in ufficio settimanali rispetto alla media delle posizioni ibride viste.",
  },
  {
    title: "Backend Developer, Python",
    company: "Cargolane",
    city: "hamburg",
    remote: "hybrid",
    sal: [58000, 72000, "EUR"],
    source: "StepStone",
    status: "scored",
    score: 69,
    family: "Backend",
    h: 70,
    jd: "Cargolane runs a logistics platform coordinating freight across European ports. You'll build backend services in Django and FastAPI, working with PostgreSQL and selective event sourcing, two days a week from the Hamburg office.",
    jdFull:
      "Cargolane connects freight forwarders and port operators through a shared logistics platform, handling booking, tracking and documentation for thousands of shipments a month.\n\nThe Role\nAs a Backend Developer, you'll work across our Django monolith and a newer set of FastAPI services, with PostgreSQL as the primary store and event sourcing used selectively for shipment tracking.\n\nResponsibilities\n- Build and maintain backend services in Django and FastAPI\n- Design PostgreSQL schemas and write performant queries\n- Contribute to the migration of tracking logic to an event-sourced model\n- Write integration tests for critical booking flows\n- Collaborate with a small ops team on deployment and monitoring\n\nWhat we offer\n- Hybrid, two days a week from our Hamburg office\n- Salary range 58,000-72,000 EUR\n- Standard German benefits package (Jobticket, pension contribution)\n- Stable, established company with low turnover\n\nRequirements\n- Solid Python backend experience with Django or FastAPI\n- Comfort with PostgreSQL and relational data modeling\n- Basic understanding of event sourcing is a plus, not required\n\nWe're a steady, un-hyped logistics company — the appeal here is stability and a well-scoped, sane engineering culture rather than hypergrowth.",
    req: [
      "3+ years Python backend experience (Django or FastAPI)",
      "Solid PostgreSQL and relational data modeling skills",
      "Basic exposure to event-driven or event-sourced systems",
      "German not required but a plus",
      "Willing to work hybrid from Hamburg",
    ],
    pros: [
      "Stack Python/PostgreSQL coerente con lo storico",
      "Azienda stabile con basso turnover",
    ],
    cons: [
      "Stipendio nella fascia media-bassa per un backend mid-level",
      "Dominio logistico poco esplorato in precedenza",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English (German gradito)\n\nRuolo backend Python su Django/FastAPI, buon match tecnico ma dominio logistico nuovo rispetto allo storico del candidato. Azienda stabile, poco esposta a hypergrowth. Stipendio nella media bassa per Amburgo.\nNOTE_MISMATCH: [SALARY] Range 58-72k leggermente sotto la mediana vista per ruoli backend mid-level in Germania.",
    scoreNotes:
      "Punteggio nella media: stack tecnico allineato ma stipendio sotto la mediana per il mercato tedesco e dominio logistico privo di precedenti diretti nello storico.",
    addr: "Speicherstadt 12, 20457 Hamburg",
  },
  {
    title: "Frontend Developer, Vue",
    company: "MarketNest",
    city: "roma",
    remote: "onsite",
    sal: [40000, 52000, "EUR"],
    source: "Indeed",
    status: "scored",
    score: 55,
    family: "Frontend",
    h: 84,
    jd: "MarketNest runs a B2B marketplace connecting Italian wholesalers with retailers. You'll maintain and extend the Vue.js frontend of the marketplace, working fully on-site from the Rome office alongside a small product team.",
    jdFull:
      "MarketNest operates a B2B marketplace where Italian wholesalers list inventory for retailers to browse and order. The platform has grown organically over five years and is due for a frontend refresh.\n\nThe Role\nWe're looking for a Frontend Developer to maintain and gradually modernize our Vue 2 application, with an eye towards an eventual Vue 3 migration.\n\nWhat you'll do\n- Maintain and extend features in Vue 2 (Options API)\n- Fix UI bugs reported by the customer support team\n- Contribute to the planning of a future Vue 3 migration\n- Work closely with a single backend developer and the founder\n- Occasionally handle basic WordPress edits for the marketing site\n\nWhat we offer\n- Fully on-site, our office is in central Rome\n- Salary range 40,000-52,000 EUR\n- Small, informal team of 6 people\n- Flexible hours around a core 10am-4pm\n\nThis is a stable, un-glamorous role at a company that isn't chasing hypergrowth — good fit for someone who wants predictability and full ownership of a well-understood codebase.",
    req: [
      "2+ years Vue.js experience (Vue 2 acceptable)",
      "Comfort maintaining legacy frontend code",
      "Basic CSS/SCSS and responsive design skills",
      "Italian fluency required, office-based role",
      "Willingness to occasionally touch WordPress",
    ],
    pros: [
      "Ruolo stabile con orari flessibili",
      "Team piccolo, alta visibilita' sulle decisioni",
    ],
    cons: [
      "Stack Vue 2 datato, nessuna prospettiva di modernizzazione a breve",
      "Full onsite, nessuna flessibilita' remote",
      "Stipendio sotto la media per Roma",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Italian\n\nRuolo Vue 2 legacy, tecnicamente datato rispetto allo stack piu' recente del candidato (React/TypeScript). Full onsite a Roma, stipendio sotto la mediana per un profilo con questa esperienza.\nNOTE_MISMATCH: [STACK] Vue 2 Options API, il candidato ha esperienza quasi esclusivamente su React/TypeScript.\nNOTE_MISMATCH: [SALARY] Range 40-52k sotto la mediana per un frontend con 2+ anni di esperienza a Roma.",
    scoreNotes:
      "Punteggio nella media-bassa: stack Vue 2 poco allineato al profilo React del candidato, stipendio sotto mercato e nessuna flessibilita' remote, ma ruolo stabile e a bassa pressione.",
  },
  {
    title: "DevOps Engineer, Azure",
    company: "Innsbruck Digital",
    city: "vienna",
    remote: "hybrid",
    sal: [55000, 70000, "EUR"],
    source: "StepStone",
    status: "scored",
    score: 63,
    family: "DevOps / Cloud",
    h: 96,
    jd: "Innsbruck Digital provides managed cloud infrastructure for Austrian SMEs, primarily on Azure. You'll handle provisioning, CI/CD pipelines and monitoring for a portfolio of client environments, hybrid from the Vienna office.",
    jdFull:
      "Innsbruck Digital is a managed services provider running Azure infrastructure for around 40 Austrian and German SME clients. Every client environment is a bit different, which makes the job varied but occasionally messy.\n\nThe Role\nAs a DevOps Engineer, you'll be responsible for provisioning, monitoring and CI/CD across our client portfolio, mostly on Azure with a few AWS environments.\n\nResponsibilities\n- Provision and maintain Azure infrastructure (ARM/Bicep templates)\n- Build and maintain Azure DevOps CI/CD pipelines for client applications\n- Monitor client environments and respond to alerts during business hours\n- Document infrastructure changes for a non-technical client-facing team\n- Occasionally travel to client sites for onboarding (rare, a few times a year)\n\nWhat we offer\n- Hybrid, two to three days a week from our Vienna office\n- Salary range 55,000-70,000 EUR\n- Company car available for occasional client visits\n- Stable client base, low churn\n\nWe're looking for someone pragmatic and communicative — a lot of this job is translating technical tradeoffs for non-technical client stakeholders.",
    req: [
      "3+ years hands-on Azure experience",
      "Familiarity with ARM templates or Bicep",
      "Azure DevOps or GitHub Actions CI/CD experience",
      "Comfort communicating with non-technical client stakeholders",
      "German helpful for client interactions",
    ],
    pros: [
      "Portfolio clienti stabile, poco churn",
      "Ruolo variegato con esposizione diretta ai clienti",
    ],
    cons: [
      "Focus quasi esclusivo su Azure, esperienza del candidato piu' orientata ad AWS/GCP",
      "Necessita' occasionale di trasferte presso i clienti",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English (German gradito per i clienti)\n\nRuolo DevOps centrato su Azure, mentre lo storico del candidato e' prevalentemente su AWS/GCP: competenze trasferibili ma non 1:1. Ruolo con componente cliente non tecnico, diverso dal contesto puramente ingegneristico delle posizioni precedenti.\nNOTE_MISMATCH: [STACK] Focus quasi esclusivo su Azure (ARM/Bicep), il candidato ha esperienza principale su AWS/Terraform.",
    scoreNotes:
      "Punteggio nella media: competenze DevOps core trasferibili ma stack cloud (Azure) diverso dallo storico prevalente, componente cliente non tecnico da valutare per fit personale.",
    addr: "Mariahilfer Strasse 88, 1070 Vienna",
  },
  {
    title: "Software Engineer, Elixir",
    company: "Fluxwave",
    remote: "full_remote",
    sal: [65000, 85000, "EUR"],
    source: "Hacker News",
    status: "scored",
    score: 72,
    family: "Backend",
    h: 105,
    jd: "Fluxwave builds real-time collaboration infrastructure for other software companies, using Elixir and Phoenix to handle millions of concurrent WebSocket connections. You'll join a small, fully remote backend team.",
    jdFull:
      "Fluxwave provides real-time presence and collaboration primitives (think live cursors, shared state, presence indicators) as an API that other SaaS companies embed into their products. Our infrastructure handles millions of concurrent WebSocket connections.\n\nThe Role\nWe're hiring a Software Engineer to work on our core Elixir/Phoenix services, focusing on connection handling, message fan-out and horizontal scaling of our real-time infrastructure.\n\nWhat you'll do\n- Build and maintain Elixir/Phoenix services handling WebSocket connections at scale\n- Work on distributed systems problems: partitioning, fan-out, backpressure\n- Write property-based tests for concurrency-sensitive code\n- Collaborate with the DevRel team on public API design\n- Contribute to public documentation and example apps\n\nWhat we offer\n- Fully remote, small team of 8 engineers across EU timezones\n- Salary range 65,000-85,000 EUR\n- Async-first, minimal meetings culture\n- Annual team offsite\n\nElixir experience is preferred but we've hired strong engineers from Erlang, Go or even functional-adjacent backgrounds who ramped up quickly. What matters most is comfort with distributed systems and concurrency.",
    req: [
      "Experience with Elixir/Phoenix or strong Erlang/BEAM familiarity",
      "Solid understanding of distributed systems and concurrency",
      "Comfort with WebSocket-based real-time architectures",
      "Experience writing property-based or concurrency-focused tests",
      "Async-first communication skills, EU timezone overlap",
    ],
    pros: [
      "Problema tecnico interessante (real-time a larga scala)",
      "Full remote con cultura async-first",
      "Team piccolo e senior",
    ],
    cons: [
      "Nessuna esperienza diretta con Elixir/Erlang nello storico del candidato",
      "Stipendio nella media, non eccezionale per il livello di complessita' tecnica",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ years (su sistemi distribuiti)\nEXPERIENCE_TYPE: preferred\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo su Elixir/Phoenix, linguaggio mai usato direttamente dal candidato, ma il problema tecnico (sistemi distribuiti, concorrenza, real-time) e' coerente con esperienze precedenti su architetture event-driven. L'annuncio stesso ammette candidature da background Go/Erlang-adjacent.\nNOTE_MISMATCH: [STACK] Elixir/Phoenix mai utilizzato dal candidato, richiede ramp-up su un linguaggio nuovo anche se il dominio (sistemi distribuiti) e' familiare.",
    scoreNotes:
      "Punteggio nella media-alta: problema tecnico e dominio (sistemi distribuiti/real-time) ben allineati, ma linguaggio Elixir completamente nuovo per il candidato, l'annuncio stesso lo rende un rischio accettabile.",
  },
  {
    title: "Data Scientist, NLP",
    company: "Lexio AI",
    city: "munich",
    remote: "hybrid",
    sal: [70000, 90000, "EUR"],
    source: "LinkedIn",
    status: "scored",
    score: 76,
    family: "AI / ML",
    h: 120,
    jd: "Lexio AI builds NLP tools for legal document analysis, used by law firms to accelerate contract review. You'll work on model fine-tuning and evaluation pipelines, hybrid from the Munich office alongside a small applied research team.",
    jdFull:
      "Lexio AI helps law firms and in-house legal teams cut contract review time by flagging risky clauses automatically. Our models are fine-tuned on a proprietary corpus of legal documents built over three years.\n\nThe Role\nAs a Data Scientist focused on NLP, you'll work on fine-tuning transformer models for clause classification and entity extraction, and on building evaluation pipelines that catch regressions before they reach production.\n\nResponsibilities\n- Fine-tune and evaluate transformer models for legal text classification\n- Build and maintain evaluation datasets and metrics dashboards\n- Collaborate with legal domain experts to label edge cases\n- Work with the platform team on model serving and latency budgets\n- Present findings to non-technical stakeholders (legal team, customers)\n\nWhat we offer\n- Hybrid, two days a week from our Munich office\n- Salary range 70,000-90,000 EUR\n- Access to a proprietary, high-quality legal text corpus\n- Small research-adjacent team with publication opportunities\n\nWe look for data scientists who are comfortable working with domain experts and who care about rigorous evaluation, not just model accuracy on a leaderboard.",
    req: [
      "3+ years applied NLP experience, ideally with transformer fine-tuning",
      "Strong Python and evaluation/metrics discipline",
      "Comfort collaborating with non-technical domain experts",
      "Experience with model serving considerations (latency, cost)",
      "German helpful but not required",
    ],
    pros: [
      "Dominio NLP interessante con dataset proprietario di qualita'",
      "Team piccolo con opportunita' di pubblicazione",
      "Stipendio nella fascia alta per Monaco",
    ],
    cons: [
      "Dominio legale molto verticale, nessuna esperienza pregressa specifica",
      "Ibrido due giorni a settimana a Monaco",
    ],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 3+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred (background quantitativo)\nLANGUAGE_REQUIRED: English (German gradito)\n\nRuolo NLP su fine-tuning di modelli transformer, buon overlap tecnico con lo storico ML del candidato ma dominio legale mai affrontato in precedenza. Azienda con dataset proprietario di qualita', segnale positivo per la maturita' del prodotto.\nNOTE_MISMATCH: [DOMAIN] Dominio legale altamente verticale, il candidato non ha esperienza pregressa nel settore ma la componente tecnica NLP resta trasferibile.",
    scoreNotes:
      "Punteggio buono: competenze NLP/transformer solide e trasferibili, dominio legale nuovo ma non bloccante, stipendio sopra la media per Monaco.",
  },
  {
    title: "QA Automation Engineer",
    company: "Testardo",
    city: "torino",
    remote: "hybrid",
    sal: [42000, 55000, "EUR"],
    source: "Indeed",
    status: "scored",
    score: 58,
    family: "QA",
    h: 130,
    jd: "Testardo builds e-commerce middleware for Italian retailers. You'll own test automation across a Java/Selenium suite and a newer Playwright-based framework, hybrid from the Turin office alongside two other QA engineers.",
    jdFull:
      "Testardo builds integration middleware that connects e-commerce platforms (Shopify, Magento) to Italian retailers' warehouse and invoicing systems. Quality matters here because a bug can mean a missed shipment or a wrong invoice.\n\nThe Role\nWe're hiring a QA Automation Engineer to maintain and extend our test automation suite, currently a mix of an older Java/Selenium framework and a newer Playwright-based one we're migrating towards.\n\nWhat you'll do\n- Maintain and extend the Selenium test suite while contributing to the Playwright migration\n- Design test plans for new integrations with e-commerce platforms\n- Set up and maintain CI pipelines for automated test runs\n- Work with developers to improve testability of new features\n- Occasionally perform manual exploratory testing for complex integrations\n\nWhat we offer\n- Hybrid, two days a week from our Turin office\n- Salary range 42,000-55,000 EUR\n- Small QA team (3 people) with room to shape practices\n- Stable client base in Italian retail\n\nThis is a good fit for someone who wants to own test strategy end-to-end rather than just executing test cases handed down by someone else.",
    req: [
      "2+ years test automation experience (Selenium and/or Playwright)",
      "Comfort setting up and maintaining CI pipelines for tests",
      "Basic scripting ability (Java, JavaScript or Python)",
      "Experience with e-commerce platform integrations a plus",
      "Italian fluency required",
    ],
    pros: [
      "Ruolo con ownership su strategia di test, non solo esecuzione",
      "Team QA piccolo con margine per definire processi",
    ],
    cons: [
      "Stipendio sotto la media per un profilo con 2+ anni di esperienza",
      "Framework di test misto (Selenium legacy + Playwright), doppio carico di manutenzione",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Italian\n\nRuolo QA automation su Selenium/Playwright, area laterale rispetto al profilo primario del candidato (piu' orientato a sviluppo). Stipendio sotto la mediana per Torino, framework di test in transizione con doppio carico di manutenzione.\nNOTE_MISMATCH: [DOMAIN] Ruolo focalizzato su QA/test automation, il candidato ha storico prevalente da sviluppatore full-stack piuttosto che QA.",
    scoreNotes:
      "Punteggio nella media-bassa: competenze di automazione trasferibili ma il ruolo e' piu' orientato a QA puro che a sviluppo, stipendio sotto mercato per l'esperienza richiesta.",
  },
  {
    title: "iOS Engineer",
    company: "Snapdeck",
    city: "copenhagen",
    remote: "hybrid",
    sal: [68000, 84000, "EUR"],
    source: "Otta",
    status: "scored",
    score: 66,
    family: "Mobile",
    h: 140,
    jd: "Snapdeck builds a photo-sharing and printing app with over 800k active users in the Nordics. You'll own the native iOS app in Swift/SwiftUI, working hybrid from the Copenhagen office alongside one other iOS engineer.",
    jdFull:
      "Snapdeck lets people turn their phone photos into printed products — photo books, prints, calendars — with same-week delivery across the Nordics. Our iOS app drives the majority of orders.\n\nThe Role\nAs an iOS Engineer, you'll work on our native SwiftUI app, from the photo editing and layout tools to the checkout and order tracking flows.\n\nWhat you'll do\n- Build and maintain features in Swift/SwiftUI\n- Optimize image processing and memory usage for large photo libraries\n- Work closely with a single designer on layout and editing tools\n- Manage App Store releases and TestFlight betas\n- Pair with the one other iOS engineer on architecture decisions\n\nWhat we offer\n- Hybrid, two days a week from our Copenhagen office\n- Salary range 68,000-84,000 EUR (or DKK equivalent)\n- Small, tight-knit team of 12 people total\n- Free prints of your own photo projects\n\nWe ship every three weeks and care a lot about smooth, delightful interactions given how visual the product is — small animation details matter here.",
    req: [
      "3+ years native iOS development with Swift/SwiftUI",
      "Experience with image-heavy or media-intensive apps",
      "Comfort managing App Store release process",
      "Attention to interaction and animation detail",
      "Willing to work hybrid from Copenhagen",
    ],
    pros: [
      "Prodotto visivo con forte attenzione al dettaglio UX",
      "Team piccolo con alta autonomia tecnica",
    ],
    cons: [
      "Nessuna esperienza pregressa specifica su app fotografiche/media-intensive",
      "Trasferimento o pendolarismo a Copenaghen da valutare",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo iOS nativo Swift/SwiftUI, buon match sullo stack ma dominio media/fotografia mai affrontato in precedenza. Team molto piccolo, alta esposizione a decisioni architetturali.\nNOTE_MISMATCH: [GEO] Richiede presenza a Copenaghen due giorni a settimana, da valutare fattibilita' logistica.",
    scoreNotes:
      "Punteggio nella media: stack Swift/SwiftUI solido, dominio media-intensive nuovo per il candidato, componente geografica (Copenaghen) da verificare.",
    addr: "Norrebrogade 55, 2200 Copenhagen",
  },
  {
    title: "Junior Fullstack Developer",
    company: "Weblab Italia",
    city: "bologna",
    remote: "onsite",
    sal: [28000, 36000, "EUR"],
    source: "Indeed",
    status: "checked",
    family: "Full-stack",
    h: 150,
    jd: "Weblab Italia is a small web agency in Bologna building custom web apps for local SMEs. You'd join as a junior developer working across a Laravel backend and a Vue frontend, learning on the job under a senior mentor.",
    jdFull:
      "Weblab Italia is a 15-person web agency based in Bologna, building custom web applications and e-commerce sites for local businesses across Emilia-Romagna.\n\nThe Role\nWe're looking for a Junior Fullstack Developer to join our small dev team of 4. You'll work on client projects across a Laravel/PHP backend and a Vue.js frontend, with close mentorship from a senior developer.\n\nWhat you'll do\n- Implement features on client projects under senior guidance\n- Fix bugs reported by clients and internal QA\n- Write basic tests for new features\n- Participate in weekly code review sessions\n- Gradually take on more independent project ownership over the first year\n\nWhat we offer\n- Fully on-site, our office is in central Bologna\n- Salary range 28,000-36,000 EUR (entry-level)\n- Structured onboarding with a dedicated mentor\n- Small agency, varied projects across different clients\n\nThis is a good starting point for someone early in their career who wants hands-on mentorship rather than being thrown into a large, siloed codebase.",
    req: [
      "0-2 years professional experience (junior level)",
      "Basic PHP/Laravel and Vue.js knowledge, even from bootcamp or personal projects",
      "Willingness to learn and take feedback in code review",
      "Italian fluency, based in or near Bologna",
    ],
    notes:
      "SENIORITY_JD: junior\nEXPERIENCE_REQUIRED: 0-2 years\nEXPERIENCE_TYPE: preferred\nDEGREE: not required\nLANGUAGE_REQUIRED: Italian\n\nRuolo junior in agenzia web con stack PHP/Laravel + Vue, livello di seniority sotto il profilo attuale del candidato e stack poco allineato allo storico (piu' orientato a Node/React). Segnalato per completezza ma probabile downgrade rispetto al livello cercato.\nNOTE_MISMATCH: [SENIORITY] Ruolo junior, il profilo del candidato e' su un livello mid/senior.\nNOTE_MISMATCH: [STACK] Stack PHP/Laravel, storico del candidato principalmente su Node/React.",
  },
  {
    title: "Cloud Architect",
    company: "Helvetia Systems",
    city: "zurich",
    remote: "hybrid",
    sal: [110000, 135000, "CHF"],
    source: "LinkedIn",
    status: "checked",
    family: "DevOps / Cloud",
    h: 155,
    jd: "Helvetia Systems is a Swiss IT consultancy helping financial institutions modernize their cloud infrastructure. You'd lead cloud architecture engagements for enterprise clients, working hybrid from the Zurich office with occasional client on-site days.",
    jdFull:
      "Helvetia Systems consults for banks and insurers across Switzerland on cloud migration and modernization, primarily on AWS and Azure. Clients are large, risk-averse organizations with strict compliance requirements.\n\nThe Role\nAs a Cloud Architect, you'll lead architecture engagements for enterprise clients, designing migration paths from legacy on-prem systems to cloud-native architectures, with a strong focus on security and compliance.\n\nResponsibilities\n- Design cloud architecture proposals for financial-sector clients\n- Lead technical workshops with client engineering and security teams\n- Define landing zones, network architecture and identity/access models\n- Mentor client engineering teams during migration execution\n- Produce architecture documentation for compliance audits\n\nWhat we offer\n- Hybrid, two to three days a week from our Zurich office, occasional client travel within Switzerland\n- Salary range 110,000-135,000 CHF\n- Strong Swiss benefits package (pension, health)\n- High-profile client base in financial services\n\nWe're looking for a senior architect who's comfortable being the technical authority in the room with skeptical, compliance-focused stakeholders.",
    req: [
      "7+ years cloud architecture experience (AWS and/or Azure)",
      "Experience in regulated industries (finance, insurance) preferred",
      "Strong grasp of security, compliance and identity architecture",
      "Consulting or client-facing experience",
      "German or French helpful for client engagements",
    ],
    notes:
      "SENIORITY_JD: lead\nEXPERIENCE_REQUIRED: 7+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: English (German/French graditi)\n\nRuolo di Cloud Architect senior in consulenza per il settore finanziario svizzero, stipendio molto sopra la media ma esperienza consulenziale diretta con clienti enterprise regolamentati non ampiamente documentata nello storico del candidato. Da verificare in fase di scoring se il gap di seniority/consulenza e' colmabile.\nNOTE_MISMATCH: [SENIORITY] Richiesti 7+ anni di esperienza specifica in architettura cloud enterprise, storico del candidato copre un livello leggermente inferiore.\nNOTE_MISMATCH: [DOMAIN] Esperienza consulenziale diretta con clienti enterprise regolamentati limitata nello storico.",
    addr: "Bahnhofstrasse 45, 8001 Zurich",
  },
  {
    title: "Rust Systems Engineer",
    company: "Kernelworks",
    remote: "full_remote",
    sal: [85000, 115000, "USD"],
    source: "Hacker News",
    status: "checked",
    family: "Backend",
    h: 165,
    jd: "Kernelworks builds a high-performance storage engine used by database vendors as an embedded component. You'd work on the core Rust codebase, focusing on performance, correctness and low-level systems concerns, fully remote.",
    jdFull:
      "Kernelworks builds an embeddable storage engine written in Rust, licensed by several database and analytics companies as a core component of their products. Correctness and performance at the byte level are what our customers pay for.\n\nThe Role\nWe're hiring a Rust Systems Engineer to work on the core storage engine: memory management, concurrency primitives, and on-disk data structures.\n\nWhat you'll do\n- Design and implement core data structures (B-trees, LSM components) in Rust\n- Profile and optimize for throughput and latency at the microsecond level\n- Write extensive property-based and fuzz tests for correctness\n- Review and mentor on unsafe Rust usage and memory safety\n- Collaborate with customer engineering teams integrating the library\n\nWhat we offer\n- Fully remote, small team of 10, mostly US and EU based\n- Salary range 85,000-115,000 USD\n- Strong systems engineering culture, deep technical discussions\n- Conference budget for Rust and database systems conferences\n\nWe look for engineers who enjoy the kind of work where a single allocation pattern change can move benchmark numbers by double digits.",
    req: [
      "Strong production Rust experience, comfort with unsafe code",
      "Systems programming background (memory management, concurrency)",
      "Experience with performance profiling and benchmarking",
      "Familiarity with database internals or storage engines a strong plus",
      "Comfort working fully async/remote across US/EU timezones",
    ],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 5+ years (systems programming)\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo Rust systems engineering molto specialistico, lontano dallo stack primario del candidato (web/backend applicativo). Nessuna esperienza Rust diretta nello storico, gap probabilmente troppo ampio per una candidatura competitiva nonostante il compenso interessante.\nNOTE_MISMATCH: [STACK] Nessuna esperienza Rust nello storico del candidato, ruolo richiede confidenza con unsafe code e systems programming.\nNOTE_MISMATCH: [SENIORITY] Richiesti 5+ anni specifici di systems programming, storico del candidato e' su stack applicativo web.",
  },
  {
    title: "Frontend Engineer, Svelte",
    company: "Ostrava Tech",
    city: "prague",
    remote: "hybrid",
    sal: [38000, 50000, "EUR"],
    source: "Company site",
    status: "new",
    family: "Frontend",
    h: 175,
    jdFull:
      "Ostrava Tech builds internal tools for logistics companies across Central Europe. Our flagship product is a dispatcher dashboard used by warehouse operators to track shipments in real time, and we recently rewrote its frontend from jQuery to Svelte.\n\nThe Role\nWe're looking for a Frontend Engineer to join the small team that just finished the Svelte rewrite and now owns its evolution.\n\nWhat you'll do\n- Build new features in SvelteKit for the dispatcher dashboard\n- Optimize real-time data rendering for warehouse floor displays\n- Work with a backend team on WebSocket-based live updates\n- Contribute to a small internal component library\n- Participate in bi-weekly releases\n\nWhat we offer\n- Hybrid, two days a week from our Prague office\n- Salary range 38,000-50,000 EUR (or CZK equivalent)\n- Small team of 5 engineers, informal culture\n- Standard Czech benefits package\n\nRequirements\n- Experience with Svelte/SvelteKit or strong Vue/React background willing to switch\n- Comfort with real-time data rendering (WebSockets)\n- Basic English for team communication, Czech helpful\n\nIf you're excited about Svelte and want to work on a product that's already live with real users rather than a greenfield prototype, this could be a good fit.",
  },
  {
    title: "Solutions Engineer",
    company: "Databridge",
    city: "madrid",
    remote: "hybrid",
    sal: [45000, 60000, "EUR"],
    source: "LinkedIn",
    status: "new",
    family: "Data",
    h: 185,
    jdFull:
      "Databridge sells a data integration platform (ETL/reverse-ETL) to mid-market companies across Southern Europe. As we grow our Madrid-based sales team, we need technical support to close and onboard customers.\n\nThe Role\nAs a Solutions Engineer, you'll be the technical voice in the sales process: running demos, scoping custom integrations, and supporting customers through onboarding.\n\nWhat you'll do\n- Run technical demos and proof-of-concepts for prospective customers\n- Scope custom connector requirements with the engineering team\n- Support customer onboarding, including basic SQL/API troubleshooting\n- Build reusable demo environments and sample integrations\n- Gather product feedback from the field and relay it to product management\n\nWhat we offer\n- Hybrid, three days a week from our Madrid office\n- Salary range 45,000-60,000 EUR\n- Uncapped commission on top of base for closed deals influenced\n- Fast-growing team, clear path to Sales Engineering lead\n\nRequirements\n- 2+ years in a technical pre-sales, solutions engineering or support role\n- Comfort with SQL and REST APIs\n- Spanish and English fluency\n- Customer-facing communication skills",
    addr: "Calle de Alcala 120, 28009 Madrid",
  },
  {
    title: "Software Engineer, Golang",
    company: "Portico",
    city: "lisbon",
    remote: "full_remote",
    sal: [55000, 72000, "EUR"],
    source: "Wellfound",
    status: "new",
    family: "Backend",
    h: 190,
    jdFull:
      "Portico builds infrastructure for API gateway and rate-limiting-as-a-service, used by other SaaS companies to manage their public APIs. Our core services are written in Go and handle several billion requests per month.\n\nThe Role\nWe're hiring a Software Engineer to work on our core Go services: routing, rate limiting, and authentication middleware that sits between our customers and their end users.\n\nWhat you'll do\n- Build and maintain high-throughput Go services for API gateway logic\n- Optimize for low-latency request handling at scale\n- Write extensive tests, including load tests for critical paths\n- Contribute to public documentation and SDK examples\n- Participate in a lightweight on-call rotation\n\nWhat we offer\n- Fully remote, small team of 7 engineers across EU timezones\n- Salary range 55,000-72,000 EUR\n- Home office stipend\n- Annual team offsite in Lisbon\n\nRequirements\n- 3+ years backend experience, ideally with Go\n- Comfort with high-throughput, low-latency systems\n- Basic understanding of networking and HTTP internals\n\nWe ship in small, frequent increments and value engineers who write clear code over clever code.",
  },
  {
    title: "PHP Developer, Legacy Migration",
    company: "Old Mill Software",
    city: "firenze",
    remote: "onsite",
    sal: [30000, 38000, "EUR"],
    source: "Indeed",
    status: "excluded",
    score: 31,
    family: "Backend",
    h: 200,
    jd: "Old Mill Software maintains legacy PHP 5 ERP-like applications for regional manufacturing clients in Florence, currently mid-migration to PHP 8. The role is fully on-site with no remote flexibility and involves ongoing legacy maintenance more than new feature development.",
    jdFull:
      "Old Mill Software has maintained custom ERP-like software for regional manufacturing companies since 2008. Several core applications still run on PHP 5.6, and we're looking for someone to help migrate them incrementally to PHP 8.\n\nThe Role\nAs a PHP Developer, you'll work primarily on legacy codebases, fixing bugs in the current PHP 5 applications while gradually porting modules to PHP 8.\n\nWhat you'll do\n- Maintain and fix bugs in PHP 5.6 legacy applications\n- Port individual modules to PHP 8 following an internal migration plan\n- Work with an on-site team of 3 developers\n- Handle occasional direct client support calls for urgent issues\n\nWhat we offer\n- Fully on-site, our office is in Florence\n- Salary range 30,000-38,000 EUR\n- Stable, long-tenured team\n- No remote flexibility currently offered\n\nThis role suits someone comfortable working with legacy code and incremental modernization rather than greenfield development.",
    cons: [
      "Stack legacy PHP 5 e lavoro di manutenzione piu' che sviluppo nuovo",
      "Full onsite senza flessibilita' remote",
    ],
    notes:
      "EXCLUDED: [STACK] PHP 5 legacy con migrazione incrementale a PHP 8, stack e tipo di lavoro (manutenzione legacy) non allineati al profilo del candidato orientato a stack moderni; inoltre full onsite senza flessibilita' e stipendio sotto soglia minima dichiarata.",
    scoreNotes:
      "Punteggio basso: stack legacy PHP 5, nessuna flessibilita' remote e stipendio ben sotto la soglia minima dichiarata dal candidato; esclusa per bassa priorita' complessiva.",
    addr: "Via Ghibellina 34, 50122 Firenze",
  },
  {
    title: "Wordpress Webmaster",
    company: "AgencyOne",
    city: "roma",
    remote: "onsite",
    sal: [24000, 30000, "EUR"],
    source: "Indeed",
    status: "excluded",
    score: 22,
    family: "Frontend",
    h: 210,
    jd: "AgencyOne is a small marketing agency in Rome looking for a webmaster to maintain WordPress sites for local clients, handling everything from theme tweaks to plugin updates and basic content edits, fully on-site.",
    jdFull:
      "AgencyOne is a small marketing agency serving local businesses in Rome with websites, social media management and basic SEO. We're looking for a Webmaster to take over day-to-day maintenance of our clients' WordPress sites.\n\nThe Role\nAs a Wordpress Webmaster, you'll handle theme customizations, plugin updates, basic content edits and troubleshooting for a portfolio of roughly 30 client sites.\n\nWhat you'll do\n- Perform routine WordPress maintenance: updates, backups, minor fixes\n- Customize themes using page builders (Elementor) and light custom CSS\n- Handle content updates requested by clients via email or phone\n- Troubleshoot hosting and plugin conflicts\n- Occasionally support basic email marketing setup\n\nWhat we offer\n- Fully on-site, our office is in Rome\n- Salary range 24,000-30,000 EUR\n- Small, informal team\n- Entry-level friendly, some training provided\n\nThis is a support-oriented role, not a development role — most of the work is configuration and content management rather than writing code.",
    cons: [
      "Ruolo di configurazione/supporto, non sviluppo software",
      "Stipendio molto sotto la soglia minima dichiarata",
    ],
    notes:
      "EXCLUDED: [SENIORITY] Ruolo di manutenzione WordPress entry-level, lavoro prevalentemente di configurazione e content management senza scrittura di codice; livello e tipo di attivita' molto sotto il profilo tecnico del candidato, stipendio (24-30k) ben sotto la soglia minima.",
    scoreNotes:
      "Punteggio molto basso: ruolo non di sviluppo, quasi esclusivamente configurazione WordPress e supporto clienti; stipendio tra i piu' bassi visti e nessun elemento tecnico rilevante per il profilo.",
  },
  {
    title: "Senior React Engineer",
    company: "Solstice Apps",
    city: "lyon",
    remote: "hybrid",
    sal: [64000, 82000, "EUR"],
    source: "LinkedIn",
    status: "new",
    family: "Frontend",
    h: 3,
    jdFull:
      "Solstice Apps builds scheduling and workforce-management software for mid-size retail chains across France and Benelux, currently used by over 400 stores. We are a 45-person product team split between Lyon and a distributed engineering pod.\n\nThe Role\n\nWe are hiring a Senior React Engineer to lead the rebuild of our store-manager dashboard, a React/TypeScript application that store managers use daily to handle shifts, swaps and payroll exports. You will work closely with a product designer and two backend engineers in a dedicated squad.\n\nWhat you'll do\n- Own the architecture of the new dashboard, migrating from class components to a modern React 18 + TypeScript stack\n- Set up and enforce a component library shared across three internal products\n- Pair with backend engineers to design clean GraphQL contracts\n- Mentor two mid-level frontend engineers\n\nWhat we offer\n- Hybrid setup, 3 days/week in our Lyon office (Part-Dieu)\n- Annual learning budget of 1,800 EUR\n- Profit-sharing scheme (intéressement) on top of base salary\n- Small, low-ego team shipping to production multiple times a day\n\nWe are an equal opportunity employer and welcome applications from all backgrounds.",
    addr: "12 Rue de la République, 69002 Lyon",
  },
  {
    title: "Backend Engineer, Ruby on Rails",
    company: "Fernbridge",
    city: "rotterdam",
    remote: "onsite",
    sal: [55000, 70000, "EUR"],
    source: "Indeed",
    status: "new",
    family: "Backend",
    h: 6,
    jdFull:
      "Fernbridge operates a B2B marketplace connecting European freight forwarders with independent truck carriers. Our platform processes several thousand shipment bookings a week and is built primarily on Ruby on Rails.\n\nThe Role\n\nAs a Backend Engineer you will join a team of six working on the booking engine, the piece of the platform that matches shipments to available carriers in near real time. This is a fully onsite role at our Rotterdam office, five minutes from Rotterdam Centraal.\n\nResponsibilities\n- Maintain and extend our core Rails monolith (Ruby 3.x, Sidekiq, PostgreSQL)\n- Improve test coverage on the booking-matching logic\n- Work directly with operations staff to fix data-quality issues surfaced in production\n- Participate in a light on-call rotation (one week every six)\n\nRequirements are listed separately, but broadly we look for solid Rails fundamentals and comfort working close to the business side.\n\nWhat we offer\n- Competitive salary plus travel allowance\n- Daily lunch at the office\n- 26 vacation days\n- A product with clear, visible impact on the logistics chain\n\nFernbridge is a 60-person company backed by a Dutch logistics group.",
    addr: "Coolsingel 42, 3011 AD Rotterdam",
  },
  {
    title: "Cloud Infrastructure Engineer",
    company: "Skyline Systems",
    city: "frankfurt",
    remote: "onsite",
    sal: [62000, 80000, "EUR"],
    source: "StepStone",
    status: "new",
    family: "DevOps / Cloud",
    h: 9,
    jdFull:
      "Skyline Systems provides colocation and managed-cloud services to mid-market banks and insurers in the DACH region, operating out of two data centers near Frankfurt.\n\nThe Role\n\nWe need a Cloud Infrastructure Engineer to join our platform team, responsible for the AWS landing zones we manage on behalf of regulated clients. The role is based onsite at our Frankfurt office due to the compliance requirements of several client contracts.\n\nWhat you'll do\n- Design and maintain multi-account AWS landing zones (Control Tower, Organizations, SCPs)\n- Automate infrastructure provisioning with Terraform across client environments\n- Support security audits and evidence collection for BaFin-regulated clients\n- Act as second-line escalation for infrastructure incidents\n\nRequirements\n- Solid AWS experience, ideally with regulated or enterprise clients\n- Strong Terraform skills\n- German language skills are a plus but not mandatory for this role\n\nWhat we offer\n- Structured onboarding with a dedicated mentor\n- 13th-month salary as per German industry norms\n- Company pension contribution\n- Stable, long-tenure engineering team\n\nSkyline Systems is an established player in the regional hosting market, not a startup, and values thoroughness over speed.",
  },
  {
    title: "Analytics Engineer",
    company: "Databay",
    city: "warsaw",
    remote: "hybrid",
    sal: [110000, 150000, "PLN"],
    source: "LinkedIn",
    status: "new",
    family: "Data",
    h: 15,
    jdFull:
      "Databay is a Warsaw-based analytics consultancy that builds data platforms for e-commerce and subscription businesses across Central Europe.\n\nThe Role\n\nWe are looking for an Analytics Engineer to join our internal data team, which maintains the modeling layer feeding dashboards used by client-facing consultants. You will sit at the intersection of raw data ingestion and business-ready reporting.\n\nWhat you'll do\n- Build and maintain dbt models on top of Snowflake, following our internal style guide\n- Partner with consultants to translate ad-hoc business questions into reusable models\n- Own data quality checks and alerting for the core revenue models\n- Document data lineage for new client onboarding\n\nWe'd like you to have\n- Strong SQL and at least one production dbt project\n- Comfort talking to non-technical stakeholders\n- Some exposure to Airflow or a similar orchestrator\n\nWhat we offer\n- Hybrid schedule, two days a week in our Warsaw office\n- Private medical package (Luxmed)\n- Multisport card\n- Small team, direct exposure to client work from day one\n\nDatabay is 22 people today, profitable, and growing through client referrals rather than paid marketing.",
    addr: "Ulica Marszałkowska 20, 00-590 Warszawa",
  },
  {
    title: "NLP Research Engineer",
    company: "Glasswing",
    remote: "full_remote",
    source: "Hacker News",
    status: "checked",
    family: "AI / ML",
    h: 24,
    jd: "Glasswing runs a document-understanding API for legal-tech and insurtech clients, extracting structured data from contracts and claims across five languages. The role focuses on fine-tuning and evaluating transformer models to raise extraction accuracy on a pipeline processing ~200k documents/month, working closely with the applied engineering team to ship research results to production. Fully remote, 14-person Series A team.",
    jdFull:
      "Glasswing builds a document-understanding API used by legal-tech and insurtech companies to extract structured data from contracts and claims documents. The core team is fully distributed across European timezones.\n\nThe Role\n\nWe are hiring an NLP Research Engineer to improve the extraction accuracy of our transformer-based pipeline, which currently processes around 200,000 documents a month across five languages.\n\nWhat you'll do\n- Fine-tune and evaluate transformer models (based on open-weight LLMs) for information extraction\n- Build evaluation harnesses to catch regressions before deploy\n- Work with the applied team to move promising research results into the production pipeline\n- Contribute to a small internal benchmark shared with two academic partners\n\nWhat we're looking for\n- Hands-on experience fine-tuning transformer models, not just calling hosted APIs\n- Comfort reading research papers and reproducing key results\n- Python, PyTorch, and familiarity with Hugging Face tooling\n\nWhat we offer\n- Fully remote, async-friendly culture with a two-day core-hours overlap\n- Conference budget for one event per year\n- Equity in a Series A company\n- Small team (14 people), high autonomy\n\nGlasswing is backed by two European VC funds and has been live in production for just over two years.",
    req: [
      "Hands-on experience fine-tuning transformer models in production",
      "Strong Python and PyTorch",
      "Familiarity with Hugging Face tooling",
      "Ability to read and reproduce research papers",
      "English fluent, team is fully distributed",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred, non vincolante\nLANGUAGE_REQUIRED: English\n\nRuolo NLP su una pipeline di document understanding gia' in produzione, coerente con l'esperienza del candidato in fine-tuning di modelli transformer. Full remote senza vincoli di fuso rigidi, solo due ore di overlap richieste. Azienda piccola (14 persone) ma con due anni di trazione in produzione, segnale positivo.\nNOTE_MISMATCH: [DOMAIN] Nessuna esperienza pregressa specifica in legal-tech, ma il dominio applicativo (NLP estrattivo) e' lo stesso gia' coperto dal candidato.",
  },
  {
    title: "Android Engineer, Payments App",
    company: "Cobalt Yard",
    city: "budapest",
    remote: "hybrid",
    sal: [48000, 62000, "EUR"],
    source: "Otta",
    status: "checked",
    family: "Mobile",
    h: 30,
    jd: "Cobalt Yard runs a consumer payments/bill-splitting app with ~500k users across Hungary and Romania. The role sits in a two-person Android squad shipping a redesigned transaction history and new recurring-payments feature in Kotlin/Compose, working closely with backend on the payments API. Hybrid, two days/week in Budapest, 30-person e-money-regulated company.",
    jdFull:
      "Cobalt Yard operates a consumer payments app used by roughly 500,000 people across Hungary and Romania to split bills and send money to friends. We are a 30-person product team headquartered in Budapest.\n\nThe Role\n\nWe are looking for an Android Engineer to join our two-person Android squad and help us ship a redesigned transaction history and a new recurring-payments feature.\n\nWhat you'll do\n- Build native Android features in Kotlin, following our Compose-based UI migration\n- Work closely with backend engineers on our payments API\n- Own crash-rate and ANR metrics for the Android app\n- Participate in fortnightly release trains\n\nWhat we're looking for\n- 3+ years of native Android development\n- Experience with Jetpack Compose or willingness to ramp up fast\n- Some exposure to financial or otherwise regulated apps is a plus\n\nWhat we offer\n- Hybrid schedule, two office days per week in our Budapest HQ\n- Cafeteria benefits package\n- Direct line to product decisions, small team\n- Stock options after 12 months\n\nCobalt Yard is regulated as an e-money institution and takes security seriously; expect a security-focused onboarding in week one.",
    req: [
      "3+ years native Android development in Kotlin",
      "Jetpack Compose experience or strong willingness to learn it",
      "Comfort with payments or other regulated-app constraints",
      "Experience owning crash-rate/ANR metrics",
      "English working proficiency",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo Android su un'app di pagamenti consumer, stack Kotlin/Compose in linea con il profilo del candidato. Il contesto regolamentato (e-money institution) e' nuovo ma non blocca il fit tecnico. Ibrido due giorni a settimana a Budapest, compatibile con trasferimento.\nNOTE_MISMATCH: [DOMAIN] Nessuna esperienza diretta in app di pagamento regolamentate, area di crescita segnalata dall'annuncio stesso.",
  },
  {
    title: "QA Engineer, Manual & Automation",
    company: "Driftwood Analytics",
    city: "oslo",
    remote: "onsite",
    sal: [420000, 520000, "NOK"],
    source: "Indeed",
    status: "checked",
    family: "QA",
    h: 36,
    jd: "Driftwood Analytics builds compliance and reporting software for Norwegian fishing/aquaculture fleets (~200 operators). This is the company's first dedicated QA hire: building manual test plans for regulatory features and a Playwright automation suite for core reporting flows, working directly with the two founding engineers. Onsite, Oslo, 18-person bootstrapped company, open to strong juniors.",
    jdFull:
      "Driftwood Analytics builds reporting software for the Norwegian fishing and aquaculture industry, used by roughly 200 fleet operators to track catch data and compliance reporting.\n\nThe Role\n\nWe are hiring our first dedicated QA Engineer. Today testing is done ad hoc by developers; you will build out both a manual test process for regulatory-sensitive features and an automation suite for the core reporting flows.\n\nWhat you'll do\n- Design and execute manual test plans for new regulatory features before each release\n- Build an automated regression suite (we use Playwright) covering the top user flows\n- Work with developers to establish a bug-triage process\n- Own the test environment and test data setup\n\nThis is an entry-to-mid level position; we are open to strong juniors with a good testing mindset.\n\nWhat we're looking for\n- 1-2 years of QA experience, manual or automated\n- Basic scripting ability (JavaScript or Python)\n- Attention to detail, comfort working with regulatory requirements\n\nWhat we offer\n- Onsite role at our Oslo office, central location\n- Standard Norwegian benefits package including pension\n- Direct mentorship from the two founding engineers\n- Opportunity to build the QA function from scratch\n\nDriftwood Analytics is an 18-person company, bootstrapped and profitable.",
    req: [
      "1-2 years of QA experience (manual or automated)",
      "Basic JavaScript or Python scripting",
      "Familiarity with Playwright or a similar automation tool",
      "Comfort working with regulatory/compliance requirements",
      "Norwegian or English working proficiency",
    ],
    notes:
      "SENIORITY_JD: junior\nEXPERIENCE_REQUIRED: 1-2 anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Norwegian or English\n\nPrimo ruolo QA dedicato in una piccola software house di settore verticale (pesca/acquacoltura), buona palestra per costruire un processo da zero. Livello junior coerente col profilo, mansioni chiare tra manuale e automazione con Playwright. Sede fissa a Oslo, nessuna opzione remota.\nNOTE_MISMATCH: [GEO] Ruolo onsite, richiede trasferimento a Oslo senza possibilita' di lavoro remoto.",
    addr: "Karl Johans gate 5, 0154 Oslo",
  },
  {
    title: "Fullstack Engineer, Marketplace",
    company: "Meridian Health",
    city: "helsinki",
    remote: "hybrid",
    sal: [58000, 76000, "EUR"],
    source: "Wellfound",
    status: "checked",
    family: "Full-stack",
    h: 42,
    jd: "Meridian Health runs a Nordic healthcare marketplace connecting private clinics with patients seeking faster appointments. The role covers patient-facing booking flows and the clinic-side dashboard, full stack across Next.js and Node/Postgres, in a four-person cross-functional squad. Hybrid, two days/week in central Helsinki, 35-person Series A company.",
    jdFull:
      "Meridian Health runs a marketplace connecting private healthcare clinics across the Nordics with patients seeking faster appointment slots than the public system offers.\n\nThe Role\n\nWe are hiring a Fullstack Engineer to join the marketplace squad, owning features across our Next.js frontend and Node/Postgres backend. You will work in a cross-functional team of four alongside a designer and a product manager.\n\nWhat you'll do\n- Build patient-facing booking flows end to end (frontend to database)\n- Improve the clinic-side dashboard used by partner clinics to manage availability\n- Contribute to our shared component library\n- Participate in bi-weekly on-call for production issues (business hours only)\n\nWhat we're looking for\n- 3+ years of fullstack experience, comfortable across the stack\n- Node.js and React/Next.js\n- PostgreSQL and basic API design\n- Interest in healthcare or consumer marketplaces is a plus\n\nWhat we offer\n- Hybrid schedule, office in central Helsinki, two days a week expected\n- Standard Finnish benefits including occupational healthcare\n- Small, senior-heavy team (average 6 years experience)\n- Clear roadmap through the next two quarters\n\nMeridian Health is a 35-person Series A company with a growing footprint in Finland and Sweden.",
    req: [
      "3+ years of fullstack experience (Node.js + React/Next.js)",
      "Solid PostgreSQL and API design skills",
      "Comfort owning features end to end",
      "English fluent; Finnish/Swedish a plus but not required",
      "Interest in healthcare or marketplace products",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English (Finnish/Swedish opzionale)\n\nRuolo fullstack su marketplace healthcare, stack Next.js/Node/Postgres pienamente coerente con l'esperienza del candidato. Team piccolo e senior, on-call limitato agli orari lavorativi. Nessuna barriera linguistica reale visto che l'inglese e' sufficiente.\nNOTE_MISMATCH: [DOMAIN] Nessuna esperienza pregressa specifica in ambito healthcare, ma il posting la segnala come 'plus' e non requisito vincolante.",
  },
  {
    title: "Frontend Engineer, Design Systems",
    company: "Pixelmark",
    remote: "full_remote",
    sal: [56000, 72000, "EUR"],
    source: "LinkedIn",
    status: "scored",
    score: 62,
    family: "Frontend",
    h: 48,
    jd: "Pixelmark builds a white-label design-system tool for digital agencies. The role focuses on the visual component authoring tool (React, TypeScript, custom canvas renderer) used by agency designers, including performance work on the live preview panel. Fully remote (EU timezones preferred), 9-person bootstrapped and profitable team.",
    jdFull:
      "Pixelmark builds a white-label design-system tool used by digital agencies to keep brand guidelines and component libraries in sync across client projects.\n\nThe Role\n\nWe are hiring a Frontend Engineer to work on our own design-system product (yes, we eat our own dog food). You will build the component authoring tool used by agency designers and developers.\n\nWhat you'll do\n- Build and maintain the visual component editor (React, TypeScript, a custom canvas renderer)\n- Work with design to keep our own design tokens in sync with the product\n- Improve performance of the live preview panel, currently a known pain point\n- Write documentation for third-party agencies integrating our tool\n\nWhat we're looking for\n- Strong React and TypeScript experience\n- Interest in design tooling or component architecture\n- Comfort with canvas/SVG rendering is a plus, not required\n\nWhat we offer\n- Fully remote, EU timezones preferred\n- Async-first culture with a weekly sync call\n- Small team of 9, flat structure\n- Learning stipend for courses/conferences\n\nPixelmark is bootstrapped, profitable, and growing slowly but steadily since 2022.",
    req: [
      "Strong React and TypeScript experience",
      "Interest in design tooling or component architecture",
      "Comfort with canvas or SVG rendering (nice to have)",
      "Async communication skills, distributed team",
      "EU timezone overlap preferred",
    ],
    pros: [
      "Stack React/TypeScript pienamente coerente con l'esperienza",
      "Full remote senza vincoli di sede",
      "Team piccolo, alta autonomia sulle decisioni tecniche",
    ],
    cons: [
      "Prodotto di nicchia (design tooling), poco visibile sul mercato",
      "Nessuna esperienza pregressa specifica con canvas/SVG rendering",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: non specificato\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo frontend su un prodotto di design tooling di nicchia, stack React/TypeScript pienamente coerente con l'esperienza del candidato. Team piccolo e full remote senza vincoli di sede, buona autonomia decisionale.\nNOTE_MISMATCH: [STACK] Nessuna esperienza pregressa specifica con canvas/SVG rendering, richiesto come plus per il ruolo.",
    scoreNotes:
      "Buon fit tecnico su React/TypeScript ma il gap su canvas rendering e la scala ridotta dell'azienda (9 persone, crescita lenta) pesano sul punteggio, che resta comunque sopra soglia minima.",
  },
  {
    title: "Senior Golang Backend Engineer",
    company: "Vantage Robotics",
    city: "porto",
    remote: "full_remote",
    sal: [58000, 78000, "EUR"],
    source: "Wellfound",
    status: "scored",
    score: 70,
    family: "Backend",
    h: 55,
    jd: "Vantage Robotics builds fleet-coordination software for warehouse robotics operators, routing hundreds of autonomous robots in real time. The role owns core Go services handling real-time telemetry and an event pipeline on Kafka, working closely with the robotics/firmware team. Fully remote in Europe with an optional Porto hub, 16-person Series A team.",
    jdFull:
      "Vantage Robotics builds fleet-management software for warehouse robotics operators, coordinating hundreds of autonomous mobile robots in real time across client warehouses in Southern Europe.\n\nThe Role\n\nWe are hiring a Senior Golang Backend Engineer to work on the fleet-coordination service, the system responsible for routing and collision avoidance across robot fleets.\n\nWhat you'll do\n- Own core services written in Go, handling real-time telemetry from thousands of connected devices\n- Improve our event-processing pipeline built on Kafka\n- Work closely with the robotics/firmware team on protocol design\n- Participate in an on-call rotation covering warehouse operating hours\n\nWhat we're looking for\n- 5+ years of backend engineering, with strong Go experience\n- Comfort with high-throughput, low-latency systems\n- Experience with Kafka or a similar event-streaming platform\n- Bonus: exposure to robotics, IoT, or real-time systems\n\nWhat we offer\n- Fully remote within Europe, with a hub office in Porto for those who want it\n- Quarterly in-person team weeks\n- Competitive salary and equity\n- Small engineering team (16 people) building genuinely novel infrastructure\n\nVantage Robotics is Series A, spun out of a robotics research lab.",
    req: [
      "5+ years backend engineering with strong Go experience",
      "Experience with high-throughput, low-latency systems",
      "Kafka or similar event-streaming platform",
      "Comfort with an operational on-call rotation",
      "Exposure to robotics/IoT/real-time systems is a plus",
    ],
    pros: [
      "Stack Go/Kafka coerente con esperienza pregressa su sistemi ad alto throughput",
      "Full remote in Europa con hub opzionale a Porto",
      "Dominio tecnico interessante (robotica/IoT), buon segnale di crescita",
    ],
    cons: [
      "On-call operativo su orari di funzionamento dei magazzini, potenzialmente serale",
      "Nessuna esperienza diretta in ambito robotica/IoT",
    ],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 5+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo backend senior su sistemi Go/Kafka ad alto throughput, coerente con l'esperienza pregressa del candidato su sistemi event-driven. Full remote in Europa con hub opzionale a Porto.\nNOTE_MISMATCH: [DOMAIN] Nessuna esperienza diretta in ambito robotica/IoT, dominio applicativo nuovo rispetto al background del candidato.",
    scoreNotes:
      "Fit solido su Go e sistemi event-driven, con gap accettabile sul dominio robotica; l'on-call operativo e la scala ancora piccola dell'azienda contengono il punteggio a livello medio.",
  },
  {
    title: "Site Reliability Engineer, AWS",
    company: "Harborlight",
    city: "tallinn",
    remote: "hybrid",
    sal: [52000, 68000, "EUR"],
    source: "StepStone",
    status: "scored",
    score: 58,
    family: "DevOps / Cloud",
    h: 60,
    jd: "Harborlight provides digital identity verification for banks and fintechs in the Baltics. The SRE role focuses on reliability of the AWS-hosted verification pipeline under banking-grade SLAs: incident response, observability with CloudWatch/Grafana, and SLO definition alongside backend engineers. Hybrid, two days/week in Tallinn, 12-person regulated company.",
    jdFull:
      "Harborlight provides digital identity verification services to banks and fintechs across the Baltics, processing document and biometric checks for onboarding flows.\n\nThe Role\n\nWe are hiring a Site Reliability Engineer to improve the reliability of our AWS-hosted verification pipeline, which needs to stay available around the clock given our banking clients' SLAs.\n\nWhat you'll do\n- Own incident response and postmortems for production issues\n- Improve observability (we use CloudWatch and a self-hosted Grafana stack)\n- Reduce toil through automation of routine operational tasks\n- Work with backend engineers to define and enforce SLOs\n\nWhat we're looking for\n- 3+ years in an SRE, DevOps, or backend-with-ops role\n- Solid AWS fundamentals (EC2, RDS, IAM, CloudWatch)\n- Experience with incident response processes\n- Scripting ability in Python or Bash\n\nWhat we offer\n- Hybrid schedule, two days a week at our Tallinn office\n- On-call compensation on top of base salary\n- Direct exposure to banking-grade reliability requirements\n- Small but experienced team (12 engineers)\n\nHarborlight is regulated and audited annually; expect a compliance-heavy onboarding.",
    req: [
      "3+ years in SRE, DevOps, or ops-heavy backend role",
      "Solid AWS fundamentals (EC2, RDS, IAM, CloudWatch)",
      "Experience with incident response and postmortems",
      "Python or Bash scripting",
      "Comfort with a compliance-heavy environment",
    ],
    pros: [
      "Buona esposizione a requisiti di affidabilita' bancari",
      "On-call compensato separatamente dallo stipendio base",
      "Team piccolo con possibilita' di impatto diretto",
    ],
    cons: [
      "Stipendio nella fascia bassa per il livello di responsabilita' richiesto",
      "Contesto fortemente regolamentato, onboarding compliance pesante",
      "Ibrido vincolante due giorni a settimana a Tallinn",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo SRE su un contesto bancario regolamentato, competenze AWS/CloudWatch coerenti con il profilo. Onboarding compliance-heavy atteso vista la natura dei clienti serviti.\nNOTE_MISMATCH: [SALARY] Stipendio nella fascia bassa rispetto al livello di responsabilita' richiesto dal ruolo.",
    scoreNotes:
      "Ruolo SRE coerente ma con compenso sotto la media per le responsabilita' richieste e un contesto compliance-heavy che allunga probabilmente l'onboarding; punteggio contenuto sotto la media.",
    addr: "Narva mnt 7, 10117 Tallinn",
  },
  {
    title: "Data Platform Engineer, Snowflake",
    company: "Quillfeather",
    city: "paris",
    remote: "hybrid",
    sal: [64000, 84000, "EUR"],
    source: "Welcome to the Jungle",
    status: "scored",
    score: 74,
    family: "Data",
    h: 65,
    jd: "Quillfeather is a media-analytics platform for publishers, processing billions of events a month. The role strengthens the Snowflake-based warehouse powering both internal reporting and a client-facing analytics product: data modeling, query/cost optimization, and Airflow ingestion pipelines. Hybrid, two days/week in Paris, 40-person profitable company.",
    jdFull:
      "Quillfeather is a media-analytics company helping publishers understand reader behavior across web and app properties, processing several billion events a month.\n\nThe Role\n\nWe are hiring a Data Platform Engineer to strengthen our Snowflake-based warehouse, which currently powers both internal reporting and a client-facing analytics product.\n\nWhat you'll do\n- Design and maintain data models in Snowflake supporting both internal and client-facing use cases\n- Optimize query performance and warehouse cost (we track this closely)\n- Build ingestion pipelines from client event streams using Airflow\n- Partner with the product team on the client-facing analytics API's data layer\n\nWhat we're looking for\n- 4+ years of data engineering experience\n- Strong SQL and hands-on Snowflake experience\n- Airflow or comparable orchestration tooling\n- Comfort working with very high event volumes\n\nWhat we offer\n- Hybrid schedule, two days a week in our Paris office\n- Meal vouchers and public transport reimbursement\n- Direct visibility into cost/performance tradeoffs at scale\n- 40-person company, stable client base of ~30 publishers\n\nQuillfeather has been profitable since year two and does not plan to raise further funding.",
    req: [
      "4+ years of data engineering experience",
      "Strong SQL and hands-on Snowflake experience",
      "Airflow or comparable orchestration tooling",
      "Comfort with very high event volumes",
      "French or English working proficiency",
    ],
    pros: [
      "Stack Snowflake/Airflow allineato all'esperienza del candidato",
      "Azienda profittevole e stabile, nessuna pressione da fundraising",
      "Scala dati interessante (miliardi di eventi/mese), buona palestra tecnica",
    ],
    cons: [
      "Ibrido due giorni a settimana a Parigi",
      "Focus stretto su ottimizzazione costi, meno spazio per nuove feature",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 4+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: French or English\n\nRuolo data platform su stack Snowflake/Airflow pienamente allineato all'esperienza del candidato, in un'azienda profittevole e stabile senza pressione da fundraising.",
    scoreNotes:
      "Buon allineamento tecnico su Snowflake e Airflow, azienda stabile e profittevole; punteggio sopra media grazie alla scala dati interessante, contenuto solo dal vincolo di presenza in ufficio.",
    addr: "18 Rue de Rivoli, 75004 Paris",
  },
  {
    title: "Machine Learning Engineer, Computer Vision",
    company: "BrightAxis",
    remote: "full_remote",
    source: "Hacker News",
    status: "scored",
    score: 68,
    family: "AI / ML",
    h: 70,
    jd: "BrightAxis builds computer-vision quality-inspection software deployed at 40+ manufacturing sites. The role trains and evaluates CNN/transformer-based defect-detection models on noisy real-world datasets and supports edge-deployment optimization. Fully remote (EU timezones), 11-person ML team, recently closed Series A.",
    jdFull:
      "BrightAxis builds computer-vision software for quality inspection on manufacturing lines, deployed at over 40 factories across Europe to catch defects that manual inspection misses.\n\nThe Role\n\nWe are hiring a Machine Learning Engineer to improve our defect-detection models and help scale our model-training pipeline to new client verticals.\n\nWhat you'll do\n- Train and evaluate computer-vision models (mostly CNN-based, some transformer experiments) on client-specific defect datasets\n- Build tooling to speed up labeling and dataset curation for new clients\n- Work with edge-deployment engineers to optimize models for on-premise inference\n- Contribute to our internal model-evaluation dashboard\n\nWhat we're looking for\n- Strong Python and PyTorch experience\n- Hands-on experience with computer vision (classification, detection, or segmentation)\n- Comfort working with imbalanced, noisy real-world datasets\n- Bonus: experience with edge/embedded model deployment\n\nWhat we offer\n- Fully remote, European timezones\n- Equipment budget for a proper home setup\n- Direct exposure to manufacturing clients and real production constraints\n- Team of 11 ML engineers, flat structure\n\nBrightAxis has been operating for four years and recently closed a Series A round.",
    req: [
      "Strong Python and PyTorch experience",
      "Hands-on computer vision experience (classification/detection/segmentation)",
      "Comfort with noisy, imbalanced real-world datasets",
      "Experience with edge/embedded model deployment is a plus",
      "English fluent, distributed team",
    ],
    pros: [
      "Esperienza CV/PyTorch del candidato ben allineata",
      "Full remote su fuso EU senza vincoli di sede",
      "Applicazione industriale concreta, non solo prototipi",
    ],
    cons: [
      "Nessuna esperienza pregressa in deployment su edge/embedded",
      "Assenza di salary range dichiarato nell'annuncio",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: non specificato\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo ML su computer vision applicata a ispezione industriale, coerente con l'esperienza PyTorch del candidato. Full remote su fuso EU, applicazione industriale concreta e non solo prototipale.\nNOTE_MISMATCH: [STACK] Nessuna esperienza pregressa in ottimizzazione di modelli per deployment edge/embedded.",
    scoreNotes:
      "Buon fit su computer vision e PyTorch, con un gap dichiarato sull'ottimizzazione per edge inference; punteggio nella media alta considerando anche l'assenza di un range salariale pubblicato.",
  },
  {
    title: "iOS Developer, Fintech App",
    company: "Solden Systems",
    city: "amsterdam",
    remote: "hybrid",
    sal: [66000, 84000, "EUR"],
    source: "LinkedIn",
    status: "scored",
    score: 63,
    family: "Mobile",
    h: 76,
    jd: "Solden Systems runs a savings/investing app for first-time investors in NL/BE (~150k active users). The role sits in a three-person mobile team building core investing flows in Swift/SwiftUI, working closely with backend on the trading API, ahead of a planned marketing push. Hybrid, two days/week in Amsterdam, AFM-licensed investment firm.",
    jdFull:
      "Solden Systems runs a savings and investing app aimed at first-time investors in the Netherlands and Belgium, with roughly 150,000 active users.\n\nThe Role\n\nWe are hiring an iOS Developer to join our three-person mobile team, working on the core investing flows (portfolio view, order placement, recurring investment plans).\n\nWhat you'll do\n- Build and maintain features in Swift/SwiftUI across the iOS app\n- Work closely with backend engineers on our trading API\n- Improve app performance and reduce crash rate ahead of a planned marketing push\n- Participate in App Store release management\n\nWhat we're looking for\n- 3+ years of native iOS development\n- SwiftUI experience, Combine is a plus\n- Interest in fintech, ideally some exposure to regulated products\n- Comfort with App Store review processes\n\nWhat we offer\n- Hybrid schedule, two days a week at our Amsterdam office\n- Standard Dutch benefits including pension contribution\n- Stock options\n- Small, focused team ahead of a Series B raise\n\nSolden Systems is licensed as an investment firm by the Dutch AFM.",
    req: [
      "3+ years native iOS development",
      "SwiftUI experience, Combine a plus",
      "Interest in fintech or regulated products",
      "Comfort with App Store review and release processes",
      "English or Dutch working proficiency",
    ],
    pros: [
      "Stack SwiftUI coerente con l'esperienza recente del candidato",
      "Prodotto con base utenti gia' consolidata (150k utenti attivi)",
      "Stock option incluse nel pacchetto",
    ],
    cons: [
      "Nessuna esperienza pregressa diretta in fintech regolamentato",
      "Team mobile molto piccolo (3 persone), poco margine di backup",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English or Dutch\n\nRuolo mobile su un'app di investimento consumer, stack SwiftUI coerente con l'esperienza recente del candidato. Team mobile piccolo (3 persone) in un'azienda regolamentata come impresa di investimento.\nNOTE_MISMATCH: [DOMAIN] Nessuna esperienza pregressa diretta in fintech regolamentato.",
    scoreNotes:
      "Fit tecnico solido su SwiftUI, gap contenuto sul dominio fintech regolamentato che non blocca la candidatura ma va segnalato; punteggio nella media.",
    addr: "Herengracht 182, 1016 BR Amsterdam",
  },
  {
    title: "QA Automation Lead",
    company: "Nimbus Circuit",
    city: "berlin",
    remote: "hybrid",
    sal: [64000, 80000, "EUR"],
    source: "LinkedIn",
    status: "scored",
    score: 71,
    family: "QA",
    h: 82,
    jd: "Nimbus Circuit builds workflow-automation software for logistics companies integrating dozens of carrier APIs. The QA Automation Lead role owns test strategy end to end, leads two QA engineers, and maintains a Playwright-based e2e suite covering carrier integrations, reporting to the VP of Engineering. Hybrid, two days/week in Berlin, 70-person stable company.",
    jdFull:
      "Nimbus Circuit builds workflow-automation software for mid-size logistics companies, integrating with dozens of third-party carrier APIs.\n\nThe Role\n\nWe are hiring a QA Automation Lead to own our testing strategy end to end, leading a small QA team of two while also writing automation directly.\n\nWhat you'll do\n- Define and drive the overall test strategy across unit, integration and end-to-end layers\n- Lead and mentor two QA engineers\n- Build and maintain our Playwright-based end-to-end suite covering carrier integrations\n- Work with engineering leadership to set quality gates for releases\n\nWhat we're looking for\n- 5+ years in QA, with at least 2 in a lead or senior individual-contributor role\n- Strong hands-on automation skills (Playwright, Cypress, or similar)\n- Experience testing integration-heavy systems (third-party APIs)\n- Comfort influencing engineering process, not just executing tests\n\nWhat we offer\n- Hybrid schedule, two days a week at our Berlin office\n- Budget to hire a third QA engineer within the first year\n- Direct reporting line to the VP of Engineering\n- Established product (6 years in market), stable client base\n\nNimbus Circuit is a 70-person company, growing steadily rather than explosively.",
    req: [
      "5+ years in QA, 2+ in a lead or senior IC role",
      "Strong hands-on automation (Playwright, Cypress, or similar)",
      "Experience testing integration-heavy systems with third-party APIs",
      "Experience mentoring or leading QA engineers",
      "English fluent, German a plus",
    ],
    pros: [
      "Ruolo di leadership tecnica coerente con l'esperienza QA del candidato",
      "Budget approvato per crescere il team a 3 persone",
      "Reporting diretto al VP Engineering, buona visibilita' interna",
    ],
    cons: [
      "Prodotto integration-heavy con molte API esterne, curva di apprendimento sul dominio",
      "Crescita aziendale dichiarata come 'steady', non esplosiva",
    ],
    notes:
      "SENIORITY_JD: lead\nEXPERIENCE_REQUIRED: 5+ anni (2+ in ruolo lead)\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English (German a plus)\n\nRuolo di leadership tecnica QA con budget approvato per crescere il team, coerente con l'esperienza del candidato nella disciplina. Reporting diretto al VP of Engineering, buona visibilita' interna.\nNOTE_MISMATCH: [DOMAIN] Prodotto integration-heavy con molte API esterne, dominio da apprendere da zero.",
    scoreNotes:
      "Buon salto di responsabilita' su un ruolo di lead con budget concreto per crescere il team; punteggio sopra media, penalizzato leggermente dal dominio di integrazione da apprendere da zero.",
  },
  {
    title: "Fullstack Developer, Node/React",
    company: "Foxglove Labs",
    city: "bologna",
    remote: "onsite",
    sal: [30000, 38000, "EUR"],
    source: "Indeed",
    status: "scored",
    score: 55,
    family: "Full-stack",
    h: 88,
    jd: "Foxglove Labs is a Bologna-based software house building custom web apps for local manufacturing and retail clients. The role is an entry-to-mid fullstack position across Node.js/Express and React, working on several client projects at once with mentorship from two senior developers. Onsite, Bologna, 12-person stable company.",
    jdFull:
      "Foxglove Labs is a small software house in Bologna building custom web applications for local manufacturing and retail clients.\n\nThe Role\n\nWe are looking for a Fullstack Developer to join our team of six, working across several small-to-medium client projects at once. This is an entry-to-mid level position, good for someone who wants broad exposure to different codebases.\n\nWhat you'll do\n- Build features across Node.js/Express backends and React frontends for various clients\n- Participate in client calls to clarify requirements alongside a senior developer\n- Fix bugs and handle small maintenance requests on older projects\n- Contribute to internal tooling used across projects\n\nWhat we're looking for\n- 1-3 years of fullstack experience with Node.js and React\n- Comfort switching between different codebases and client contexts\n- Italian required for client communication, English useful for documentation\n\nWhat we offer\n- Onsite role at our Bologna office, central location near the university district\n- Structured mentorship from two senior developers\n- Exposure to a wide range of industries and technical challenges\n- Standard Italian contract (CCNL Metalmeccanico)\n\nFoxglove Labs is a 12-person software house, stable but modestly growing.",
    req: [
      "1-3 years of fullstack experience (Node.js + React)",
      "Comfort switching between different client codebases",
      "Italian required for client communication",
      "Basic English for documentation",
      "Willingness to work fully onsite",
    ],
    pros: [
      "Buona palestra di varieta' tecnica su piu' progetti client",
      "Mentorship strutturata da sviluppatori senior",
    ],
    cons: [
      "Stipendio nella fascia bassa del mercato locale",
      "Ruolo onsite senza opzione ibrida o remota",
      "Progetti di piccola scala, minore profondita' tecnica",
    ],
    notes:
      "SENIORITY_JD: junior\nEXPERIENCE_REQUIRED: 1-3 anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Italian (required) + English\n\nRuolo fullstack entry-to-mid su piu' progetti client di piccola scala, buona palestra di varieta' tecnica con mentorship strutturata da sviluppatori senior.\nNOTE_MISMATCH: [SALARY] Stipendio nella fascia bassa del mercato locale per il profilo.\nNOTE_MISMATCH: [GEO] Ruolo onsite senza alcuna opzione ibrida o remota.",
    scoreNotes:
      "Ruolo adatto a un profilo junior/early-mid, ma lo stipendio sotto media e l'assenza totale di flessibilita' oraria/remota contengono il punteggio sotto la soglia media.",
    addr: "Via Zamboni 15, 40126 Bologna",
  },
  {
    title: "UI Engineer, Angular",
    company: "Anchorpoint",
    city: "vienna",
    remote: "hybrid",
    sal: [50000, 64000, "EUR"],
    source: "StepStone",
    status: "scored",
    score: 66,
    family: "Frontend",
    h: 95,
    jd: "Anchorpoint builds project-management software for construction companies, used from tablets on active sites. The UI Engineer role works on the Angular 17 frontend with strong focus on tablet/touch UX and offline-first resilience, collaborating with a UX researcher and backend engineers on a .NET API. Hybrid, two days/week in Vienna, 50-person established company.",
    jdFull:
      "Anchorpoint builds project-management software for construction companies, used by site managers to track schedules, materials and subcontractor invoices.\n\nThe Role\n\nWe are hiring a UI Engineer to work on our Angular-based frontend, which is used heavily from tablets on active construction sites, so performance and offline resilience matter a lot.\n\nWhat you'll do\n- Build and maintain features in Angular 17, with a strong focus on tablet/touch UX\n- Improve offline-first behavior using service workers and local caching\n- Work with a UX researcher who regularly visits construction sites for feedback\n- Collaborate with backend engineers on a .NET API\n\nWhat we're looking for\n- 3+ years of frontend experience, ideally with Angular\n- Interest in offline-first, resilient web applications\n- Comfort with touch-first UI design constraints\n\nWhat we offer\n- Hybrid schedule, two days a week at our Vienna office\n- Standard Austrian benefits package\n- Direct access to end users through regular site visits\n- Established product (8 years in market) with a loyal customer base\n\nAnchorpoint is a 50-person company, part of a larger construction-tech group.",
    req: [
      "3+ years of frontend experience, ideally Angular",
      "Interest in offline-first web applications",
      "Comfort with touch-first UI design constraints",
      "Experience integrating with a REST API (.NET here)",
      "German or English working proficiency",
    ],
    pros: [
      "Prodotto maturo con base clienti consolidata",
      "Accesso diretto agli utenti finali tramite visite in cantiere",
    ],
    cons: [
      "Stack Angular, diverso dal framework prevalente nell'esperienza recente del candidato",
      "Focus offline-first, area tecnica non ancora esplorata dal candidato",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: German or English\n\nRuolo UI su un prodotto maturo per il settore costruzioni, con forte focus su tablet/touch UX e offline-first, aree tecniche non ancora esplorate dal candidato ma con fondamenta frontend trasferibili.\nNOTE_MISMATCH: [STACK] Stack Angular, diverso dal framework prevalente (React) nell'esperienza recente del candidato.",
    scoreNotes:
      "Il gap sullo stack Angular rispetto all'esperienza React prevalente del candidato pesa sul punteggio, mitigato da solide fondamenta frontend trasferibili; punteggio nella media.",
  },
  {
    title: "Backend Developer, Java Spring",
    company: "Cinder Works",
    remote: "full_remote",
    sal: [72000, 95000, "USD"],
    source: "LinkedIn",
    status: "scored",
    score: 60,
    family: "Backend",
    h: 100,
    jd: "Cinder Works builds infrastructure-monitoring software focused on cost-efficient metrics storage. The role maintains Java/Spring Boot ingestion services handling several million data points per minute and works on query performance for a custom time-series engine, alongside SRE on capacity planning. Fully remote with US timezone overlap expected, 40-engineer Series B company.",
    jdFull:
      "Cinder Works builds infrastructure-monitoring software for DevOps teams, competing in a crowded observability market with a focus on cost-efficient metrics storage.\n\nThe Role\n\nWe are hiring a Backend Developer to work on our metrics-ingestion service, a Java/Spring Boot system handling several million data points per minute.\n\nWhat you'll do\n- Maintain and extend our Spring Boot ingestion services\n- Work on query performance for our custom time-series storage engine\n- Collaborate with the SRE team on capacity planning\n- Participate in an on-call rotation (one week every eight)\n\nWhat we're looking for\n- 4+ years of backend development, strong Java and Spring Boot\n- Experience with high-throughput, latency-sensitive systems\n- Familiarity with time-series data is a plus\n- Comfort in a fully remote, US-headquartered but globally distributed team\n\nWhat we offer\n- Fully remote, flexible hours with some US timezone overlap expected\n- Competitive USD-denominated salary\n- Annual company offsite\n- Team of 40 engineers, established observability product\n\nCinder Works is Series B, profitable in its core enterprise segment.",
    req: [
      "4+ years of backend development, strong Java/Spring Boot",
      "Experience with high-throughput, latency-sensitive systems",
      "Familiarity with time-series data is a plus",
      "Comfort with US timezone overlap",
      "English fluent",
    ],
    pros: [
      "Compenso in USD sopra la media di mercato europea",
      "Sistema ad alto volume di dati, buona sfida tecnica",
    ],
    cons: [
      "Overlap richiesto con orari USA, possibile impatto su work-life balance",
      "Stack Java/Spring meno centrale nell'esperienza recente del candidato",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 4+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo backend su un sistema di metriche ad alto volume, compenso in USD sopra la media di mercato europea a fronte di un moderato gap sullo stack Java/Spring.\nNOTE_MISMATCH: [STACK] Stack Java/Spring meno centrale nell'esperienza recente del candidato, prevalentemente orientata ad altri linguaggi.",
    scoreNotes:
      "Compenso interessante ma l'overlap con fuso USA e un gap moderato sullo stack Java pesano sul punteggio, che resta nella media.",
  },
  {
    title: "Platform Engineer, GCP",
    company: "Nordwind",
    city: "stockholm",
    remote: "hybrid",
    sal: [640000, 820000, "SEK"],
    source: "LinkedIn",
    status: "writing",
    score: 78,
    family: "DevOps / Cloud",
    h: 110,
    wr: true,
    jd: "Nordwind operates a district-heating optimization platform for municipal utilities across Sweden and Finland. The role strengthens the GCP/GKE-based platform running real-time optimization models: cluster management, CI/CD for the data-science team's model-serving workloads, and observability across Go and Python services. Hybrid, two days/week in Stockholm, 25-engineer climate-tech company.",
    jdFull:
      "Nordwind operates a district-heating optimization platform used by municipal utilities across Sweden and Finland to reduce energy waste in residential heating networks.\n\nThe Role\n\nWe are hiring a Platform Engineer to strengthen our GCP-based infrastructure, which runs the real-time optimization models used to control heating output across dozens of municipal networks.\n\nWhat you'll do\n- Own our GKE-based platform, including cluster upgrades and cost optimization\n- Build CI/CD pipelines for the data-science team's model-serving workloads\n- Improve observability across a mix of Go services and Python model-serving containers\n- Support municipal-utility clients during onboarding of new heating networks\n\nWhat we're looking for\n- 4+ years of platform/infrastructure engineering\n- Strong GCP experience, GKE in particular\n- Comfort supporting both software engineers and data scientists\n- Terraform for infrastructure as code\n\nWhat we offer\n- Hybrid schedule, two days a week at our Stockholm office\n- Meaningful climate-impact mission (measurable energy savings per client)\n- Standard Swedish benefits including generous parental leave policy\n- Team of 25 engineers, mission-driven culture\n\nNordwind is backed by a Nordic climate-tech fund and has been operating for five years.",
    req: [
      "4+ years of platform/infrastructure engineering",
      "Strong GCP experience, particularly GKE",
      "Terraform for infrastructure as code",
      "Comfort supporting both engineers and data scientists",
      "English fluent, Swedish a plus",
    ],
    pros: [
      "Missione climate-tech con impatto misurabile, forte motivazione",
      "Stack GCP/GKE coerente con esperienza cloud pregressa",
      "Team ingegneristico di dimensioni solide (25 persone)",
    ],
    cons: [
      "Supporto a workload data-science richiede coordinamento cross-team non banale",
      "Ibrido due giorni a settimana a Stoccolma",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 4+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English (Swedish a plus)\n\nRuolo platform su stack GCP/GKE coerente con l'esperienza cloud pregressa del candidato, in un'azienda climate-tech con missione motivante e team ingegneristico solido.",
    scoreNotes:
      "Ottimo fit tecnico su GCP/GKE unito a una missione aziendale motivante; punteggio sopra media, leggermente contenuto dalla complessita' di supporto a workload eterogenei (SWE + data science).",
  },
  {
    title: "Analytics Engineer, dbt & Airflow",
    company: "Pipebase",
    remote: "full_remote",
    source: "Company site",
    status: "writing",
    score: 82,
    family: "Data",
    h: 116,
    wr: true,
    jd: "Pipebase provides ELT infrastructure and data-contracts tooling for B2B SaaS data teams. The role owns the internal dbt project (product usage, billing, support data) and Airflow orchestration across a dozen internal sources, while also serving as a reference implementation for customer case studies. Fully remote, async-first, 18-person Series A team.",
    jdFull:
      "Pipebase provides ELT infrastructure and data contracts tooling for mid-market B2B SaaS companies, helping their data teams avoid breaking changes between producer and consumer teams.\n\nThe Role\n\nWe are hiring an Analytics Engineer to work on our own internal data platform (we use our own product internally, and it needs to be a strong reference implementation).\n\nWhat you'll do\n- Own the internal dbt project modeling product usage, billing, and support data\n- Build and maintain Airflow DAGs orchestrating ingestion from a dozen internal sources\n- Define and enforce data contracts between our own product teams as a reference case for customers\n- Partner with the customer-success team to build case studies from our internal setup\n\nWhat we're looking for\n- 3+ years of analytics engineering experience\n- Strong dbt and SQL skills\n- Airflow or a comparable orchestrator\n- Comfort explaining technical tradeoffs to non-technical stakeholders (for case studies)\n\nWhat we offer\n- Fully remote, async-first, small overlap window required\n- Direct influence on the product roadmap through internal dogfooding feedback\n- Equity in a Series A company\n- Small, senior team (18 people)\n\nPipebase closed its Series A eight months ago and is growing its customer base steadily.",
    req: [
      "3+ years of analytics engineering experience",
      "Strong dbt and SQL skills",
      "Airflow or comparable orchestrator",
      "Comfort explaining technical tradeoffs to non-technical stakeholders",
      "English fluent, distributed async team",
    ],
    pros: [
      "Stack dbt/Airflow perfettamente allineato all'esperienza del candidato",
      "Ruolo con influenza diretta sulla roadmap di prodotto tramite dogfooding",
      "Full remote async-first con overlap minimo richiesto",
    ],
    cons: [
      "Richiede anche capacita' di comunicazione verso clienti per i case study, non solo lavoro tecnico",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo analytics engineering su stack dbt/Airflow quasi ideale rispetto all'esperienza del candidato, con visibilita' diretta sulla roadmap di prodotto tramite dogfooding interno.",
    scoreNotes:
      "Fit quasi ideale su dbt/Airflow con un ruolo che offre visibilita' diretta sul prodotto; punteggio alto, unico neo la componente di comunicazione esterna non tipica di un ruolo puramente tecnico.",
  },
  {
    title: "MLOps Engineer",
    company: "Lexio AI",
    city: "munich",
    remote: "hybrid",
    sal: [78000, 98000, "EUR"],
    source: "LinkedIn",
    status: "review",
    score: 80,
    family: "AI / ML",
    h: 122,
    jd: "Lexio AI builds multilingual NLP tooling for enterprise customer-support automation across DACH. The MLOps role builds CI/CD for model training/deployment, owns the model registry across client-specific fine-tunes, and improves drift/latency monitoring in production, working closely with data science. Hybrid, two days/week in Munich, 60-person profitable company.",
    jdFull:
      "Lexio AI builds NLP tooling for multilingual customer-support automation, serving enterprise clients across the DACH region who need support in German, English and French.\n\nThe Role\n\nWe are hiring an MLOps Engineer to build out the infrastructure supporting our NLP model lifecycle, from training to production serving across multiple client deployments.\n\nWhat you'll do\n- Build and maintain CI/CD pipelines for model training and deployment\n- Own our model registry and versioning strategy across client-specific fine-tunes\n- Improve monitoring for model drift and latency in production\n- Work closely with the data science team to reduce the time from experiment to production\n\nWhat we're looking for\n- 4+ years combining software engineering and ML infrastructure\n- Experience with Kubernetes-based model serving\n- Strong Python, comfort with MLflow or a similar experiment-tracking tool\n- Familiarity with multi-tenant model deployment patterns\n\nWhat we offer\n- Hybrid schedule, two days a week at our Munich office\n- Standard German benefits package\n- Direct collaboration with a strong data science team (this posting follows our earlier NLP research hire)\n- Established client base of 15+ enterprise accounts\n\nLexio AI is an 60-person company, profitable, and a recognized player in the German NLP market.",
    req: [
      "4+ years combining software engineering and ML infrastructure",
      "Kubernetes-based model serving experience",
      "Strong Python, MLflow or similar experiment tracking",
      "Familiarity with multi-tenant model deployment",
      "German or English working proficiency",
    ],
    pros: [
      "Azienda gia' nota dal profilo (secondo ruolo Lexio AI incontrato), reputazione confermata solida",
      "Stack Kubernetes/MLflow allineato all'esperienza MLOps del candidato",
      "Base clienti enterprise consolidata, minore rischio di instabilita'",
    ],
    cons: [
      "Ibrido due giorni a settimana a Monaco",
      "Richiede coordinamento stretto con data science su piu' fine-tune per cliente, complessita' operativa non banale",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 4+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: German or English\n\nRuolo MLOps su stack Kubernetes/MLflow allineato all'esperienza del candidato, presso un'azienda gia' nota positivamente da una posizione precedente dello stesso profilo.",
    scoreNotes:
      "Ottimo fit tecnico su MLOps/Kubernetes in un'azienda gia' vista positivamente in una posizione precedente dello stesso profilo; punteggio alto, contenuto solo dalla complessita' del multi-tenant fine-tuning.",
    addr: "Maximilianstrasse 35, 80539 Munich",
  },
  {
    title: "Senior Frontend Engineer, Vue 3 Migration",
    company: "MarketNest",
    city: "roma",
    remote: "onsite",
    sal: [46000, 58000, "EUR"],
    source: "Indeed",
    status: "review",
    score: 73,
    family: "Frontend",
    h: 128,
    jd: "MarketNest runs a regional classifieds marketplace with a legacy Vue 2 frontend now migrating to Vue 3. The role leads the incremental migration end to end (Options API to Composition API), sets up regression testing, and mentors two mid-level developers, coordinating with backend on API changes. Onsite, Rome, 35-person established company, migration is a company priority this year.",
    jdFull:
      "MarketNest runs a local classifieds marketplace popular in central Italy, with a legacy Vue 2 frontend that the team is now migrating to Vue 3.\n\nThe Role\n\nWe are hiring a Senior Frontend Engineer to lead the Vue 2 to Vue 3 migration of our main marketplace application, working alongside two mid-level frontend developers.\n\nWhat you'll do\n- Plan and execute the incremental migration from Vue 2 (Options API) to Vue 3 (Composition API)\n- Set up automated regression testing to catch breakage during the migration\n- Mentor two mid-level developers through the new patterns\n- Coordinate with backend engineers on any API changes needed along the way\n\nWhat we're looking for\n- 5+ years of frontend experience, strong Vue.js background\n- Direct experience with a Vue 2 to Vue 3 migration is a strong plus\n- Comfort leading a technical initiative end to end\n- Italian required, this is a fully onsite role\n\nWhat we offer\n- Onsite role at our Rome office, central location\n- Standard Italian contract with meal vouchers\n- High-visibility project (the migration is a company priority for this year)\n- Established product (10+ years in market) with loyal local user base\n\nMarketNest is a 35-person company, majority Italian team.",
    req: [
      "5+ years of frontend experience with strong Vue.js background",
      "Direct experience with a Vue 2 to Vue 3 migration is a strong plus",
      "Comfort leading a technical initiative end to end",
      "Experience mentoring mid-level developers",
      "Italian required, fully onsite role",
    ],
    pros: [
      "Progetto ad alta visibilita' interna, priorita' aziendale dichiarata per l'anno",
      "Stack Vue coerente con esperienza gia' vista sullo stesso profilo (posizione MarketNest precedente)",
      "Ruolo di mentorship e leadership tecnica, buon passo di crescita",
    ],
    cons: [
      "Ruolo onsite senza alcuna flessibilita' remota",
      "Stipendio nella media locale, non particolarmente competitivo per il livello senior richiesto",
    ],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 5+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Italian (required)\n\nRuolo di guida tecnica su una migrazione Vue 2 a Vue 3 ad alta visibilita' interna, stack coerente con esperienza gia' vista sullo stesso profilo su una posizione precedente presso la stessa azienda.\nNOTE_MISMATCH: [GEO] Ruolo onsite a Roma, senza alcuna opzione di lavoro remoto o ibrido.",
    scoreNotes:
      "Ottimo allineamento tecnico su Vue e ruolo di responsabilita' crescente, ma il vincolo onsite rigido e uno stipendio solo nella media contengono il punteggio poco sopra la soglia buona.",
    addr: "Via del Corso 210, 00186 Roma",
  },
  {
    title: "Staff Backend Engineer, Payments Core",
    company: "FinPilot",
    city: "amsterdam",
    remote: "hybrid",
    sal: [88000, 112000, "EUR"],
    source: "LinkedIn",
    status: "ready",
    score: 89,
    family: "Backend",
    h: 133,
    critic: [8, "PASS"],
    jd: "FinPilot builds payments infrastructure for European marketplaces, processing settlement flows for 200+ platform clients. This Staff role takes technical ownership of the payments-core ledger and settlement logic (Kotlin, Kafka, PostgreSQL), leading design reviews and mentoring across a six-engineer squad. Hybrid, two days/week in Amsterdam, 140-person profitable Series C company.",
    jdFull:
      "FinPilot builds payments infrastructure for European marketplaces, processing settlement flows for over 200 platform clients. Our payments-core team owns the ledger and settlement logic underpinning every transaction on the platform.\n\nThe Role\n\nWe are hiring a Staff Backend Engineer to take technical ownership of the payments-core service, working across a squad of six engineers and setting technical direction for the next phase of scaling.\n\nWhat you'll do\n- Own the architecture of our double-entry ledger system (Kotlin, Kafka, PostgreSQL)\n- Lead design reviews for major changes to settlement logic\n- Mentor senior and mid-level engineers across the payments-core team\n- Partner with compliance on audit-readiness of the ledger\n\nWhat we're looking for\n- 8+ years of backend engineering, with staff-level scope in at least one prior role\n- Deep experience with event-driven architectures (Kafka or similar)\n- Track record with financial or otherwise high-correctness systems\n- Strong technical communication and design-review skills\n\nWhat we offer\n- Hybrid schedule, two days a week at our Amsterdam office (Zuidas)\n- Staff-level compensation band with meaningful equity\n- Direct influence on the platform's core financial correctness\n- Team culture built around strict correctness and blameless postmortems\n\nFinPilot is a 140-person company, Series C, profitable in its core European markets.",
    req: [
      "8+ years of backend engineering with staff-level scope",
      "Deep experience with event-driven architectures (Kafka or similar)",
      "Track record with financial or high-correctness systems",
      "Strong design-review and technical communication skills",
      "Experience mentoring senior engineers",
    ],
    pros: [
      "Ruolo staff con scope tecnico ampio, coerente con seniority del candidato",
      "Secondo incontro con FinPilot (gia' vista positivamente su altra posizione), azienda affidabile e correttezza come valore centrale",
      "Compenso nella fascia alta, equity significativa",
    ],
    cons: ["Ibrido due giorni a settimana ad Amsterdam"],
    notes:
      "SENIORITY_JD: lead\nEXPERIENCE_REQUIRED: 8+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo staff con scope tecnico ampio su un ledger di pagamenti ad alta correttezza, pienamente coerente con la seniority del candidato e con un secondo incontro positivo con la stessa azienda.",
    scoreNotes:
      "Eccellente allineamento su seniority e dominio (sistemi finanziari ad alta correttezza), azienda gia' apprezzata in una candidatura precedente dello stesso profilo; punteggio molto alto.",
    criticNotes:
      "Round 1: 7.5/10, Round 2: 8/10, Round 3: 8/10. Verdict: PASS. Strength: CV evidenzia con chiarezza esperienza pregressa su sistemi event-driven e correttezza finanziaria, buon uso di esempi concreti su design review guidate. Gap: nessuna esperienza staff-level formale dichiarata in precedenza, il CV la inquadra correttamente come 'scope equivalente' senza inventare titoli.",
    addr: "Zuidas, Gustav Mahlerlaan 22, 1082 Amsterdam",
  },
  {
    title: "Head of Platform Engineering",
    company: "GreenGrid",
    city: "amsterdam",
    remote: "full_remote",
    sal: [105000, 130000, "EUR"],
    source: "Otta",
    status: "ready",
    score: 92,
    family: "DevOps / Cloud",
    h: 138,
    critic: [9, "PASS"],
    jd: "GreenGrid runs a multi-tenant Kubernetes platform for energy-tech companies, shared infrastructure for 60+ internal engineers. This Head of Platform Engineering role builds a dedicated platform team from the current IC group, sets the 18-month roadmap, and owns standards for reliability, cost, and developer experience. Fully remote with periodic Amsterdam visits, 90-person Series B company.",
    jdFull:
      "GreenGrid runs a multi-tenant Kubernetes platform for energy-tech companies, serving as shared infrastructure for over 60 internal engineers across several product teams.\n\nThe Role\n\nWe are hiring a Head of Platform Engineering to lead our platform organization through its next phase, building out a dedicated platform team from the current group of individual contributors.\n\nWhat you'll do\n- Define the platform engineering roadmap for the next 18 months\n- Hire and lead a team of 6-8 platform engineers, starting from the existing IC group\n- Own the relationship between platform and product engineering leadership\n- Set standards for cluster reliability, cost management, and developer experience across the company\n\nWhat we're looking for\n- 8+ years in infrastructure/platform engineering, with 3+ years in a leadership role\n- Deep Kubernetes and cloud (AWS) expertise\n- Track record building or scaling a platform team from scratch\n- Strong stakeholder-management skills across engineering leadership\n\nWhat we offer\n- Fully remote, with a strong preference for candidates able to visit Amsterdam periodically\n- Leadership-level compensation and equity package\n- Direct reporting line to the VP of Engineering\n- A company mission (energy-tech, measurable carbon impact) that the team is genuinely motivated by\n\nGreenGrid is a 90-person company, Series B, and has been a strong reference employer for platform engineers historically.",
    req: [
      "8+ years in infrastructure/platform engineering, 3+ in leadership",
      "Deep Kubernetes and AWS expertise",
      "Track record building or scaling a platform team",
      "Strong stakeholder-management skills",
      "English fluent",
    ],
    pros: [
      "Ruolo di leadership naturale evoluzione dell'esperienza platform/Kubernetes del candidato",
      "Azienda gia' nota positivamente da altra posizione (stessa famiglia tecnica), reputazione confermata",
      "Full remote con solo visite periodiche richieste, ottima flessibilita'",
      "Compenso e equity di livello leadership",
    ],
    cons: [
      "Richiede costruire un team da zero partendo da IC, sfida organizzativa non solo tecnica",
    ],
    notes:
      "SENIORITY_JD: lead\nEXPERIENCE_REQUIRED: 8+ anni (3+ in leadership)\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo di leadership naturale evoluzione dell'esperienza platform/Kubernetes del candidato, presso un'azienda gia' nota positivamente da un'altra posizione della stessa famiglia tecnica.",
    scoreNotes:
      "Eccellente evoluzione di carriera coerente con l'expertise Kubernetes/platform gia' dimostrata, azienda con reputazione solida e piena flessibilita' remota; punteggio tra i piu' alti del set.",
    criticNotes:
      "Round 1: 8/10, Round 2: 9/10, Round 3: 9/10. Verdict: PASS. Strength: CV mostra progressione chiara da IC a responsabilita' di piattaforma piu' ampie, con metriche concrete su affidabilita' cluster. Gap: esperienza di people management ancora limitata rispetto allo scope richiesto (6-8 riporti), il CV la presenta onestamente come area di crescita.",
  },
  {
    title: "Lead Fullstack Engineer, Patient Portal",
    company: "AtlasCare",
    city: "milano",
    remote: "hybrid",
    sal: [82000, 102000, "EUR"],
    source: "Wellfound",
    status: "ready",
    score: 85,
    family: "Full-stack",
    h: 143,
    critic: [7, "PASS"],
    jd: "AtlasCare builds patient-facing healthtech tools for Italian clinics. This Lead role takes technical ownership of the patient portal (Next.js/Node/Postgres), leading a four-engineer squad through sprint planning, design reviews, and roadmap balancing between features and tech debt. Hybrid, two days/week in Milan, 80-person Series B healthtech company.",
    jdFull:
      "AtlasCare builds patient-facing healthtech tools used by clinics across Italy to manage appointments, prescriptions and patient communication.\n\nThe Role\n\nWe are hiring a Lead Fullstack Engineer to take ownership of the patient portal, our most-used product surface, leading a squad of four engineers.\n\nWhat you'll do\n- Set technical direction for the patient portal (Next.js frontend, Node/Postgres backend)\n- Lead sprint planning and technical design reviews for the squad\n- Balance new feature delivery with paying down accumulated technical debt\n- Represent the engineering team in product roadmap discussions\n\nWhat we're looking for\n- 6+ years of fullstack experience, with 1-2 years in a lead or tech-lead role\n- Strong Node.js and React/Next.js background\n- Comfort balancing hands-on coding with team leadership\n- Italian and English fluent (clinic-facing product)\n\nWhat we offer\n- Hybrid schedule, two days a week at our Milan office\n- Leadership-track compensation band\n- Direct impact on a healthtech product used by real patients\n- Established, well-funded team (this is our second open role in the fullstack org)\n\nAtlasCare is a 80-person Series B healthtech company.",
    req: [
      "6+ years of fullstack experience, 1-2 years in a lead/tech-lead role",
      "Strong Node.js and React/Next.js background",
      "Comfort balancing hands-on coding with team leadership",
      "Italian and English fluent",
      "Experience with healthtech or another regulated domain is a plus",
    ],
    pros: [
      "Naturale passo di crescita da un ruolo fullstack gia' visto positivamente in azienda (stessa company, seniority superiore)",
      "Prodotto con impatto reale su pazienti, forte motivazione di dominio",
      "Compenso nella fascia leadership, sopra la media del mercato locale",
    ],
    cons: [
      "Ibrido due giorni a settimana a Milano",
      "Bilanciare hands-on coding e leadership puo' diluire il tempo di sviluppo puro",
    ],
    notes:
      "SENIORITY_JD: lead\nEXPERIENCE_REQUIRED: 6+ anni (1-2 in ruolo lead)\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Italian and English\n\nRuolo di lead fullstack naturale passo di crescita da una posizione gia' vista positivamente presso la stessa azienda, con impatto diretto su un prodotto healthtech usato da pazienti reali.",
    scoreNotes:
      "Ottima progressione di carriera su un'azienda gia' nota e apprezzata, con impatto di prodotto concreto e compenso competitivo; punteggio alto.",
    criticNotes:
      "Round 1: 6.5/10, Round 2: 7/10, Round 3: 7/10. Verdict: PASS. Strength: CV documenta bene esperienza fullstack profonda e primi segnali di leadership tecnica (ownership di feature end-to-end, mentoring occasionale). Gap: esperienza formale di sprint planning/team lead ancora limitata, il CV non la sovradimensiona.",
    addr: "Corso Buenos Aires 45, 20124 Milano",
  },
  {
    title: "Senior Machine Learning Engineer, NLP",
    company: "SignalForge",
    remote: "full_remote",
    sal: [118000, 145000, "USD"],
    source: "Hacker News",
    status: "ready",
    score: 90,
    family: "AI / ML",
    h: 148,
    critic: [8, "PASS"],
    jd: "SignalForge builds applied ML for industrial IoT, with a growing NLP practice extracting signals from maintenance logs to predict equipment failures. This Senior role leads the NLP workstream (currently 2 people), combining NLP features with the existing time-series anomaly-detection pipeline and shipping to production on Spark/Kubernetes. Fully remote, USD compensation, 9-person senior ML team.",
    jdFull:
      "SignalForge builds applied ML systems for industrial IoT clients, with a growing NLP practice analyzing maintenance logs and technician reports to predict equipment failures earlier.\n\nThe Role\n\nWe are hiring a Senior Machine Learning Engineer to lead the NLP workstream within our applied ML team, building on the time-series anomaly detection work the company is already known for.\n\nWhat you'll do\n- Build NLP models to extract structured signals from unstructured maintenance logs\n- Combine NLP-derived features with our existing time-series anomaly-detection pipeline\n- Set technical direction for the NLP workstream, currently a team of two\n- Ship models to production on our existing Spark/Kubernetes serving infrastructure\n\nWhat we're looking for\n- 6+ years of ML engineering, with strong NLP experience specifically\n- Track record shipping NLP models to production, not just research\n- Comfort combining structured and unstructured data sources\n- Experience mentoring junior ML engineers\n\nWhat we offer\n- Fully remote, no EU office requirement\n- Compensation in USD, above-market for the applied ML space\n- Direct continuity with our existing anomaly-detection product (well-regarded internally)\n- Small, senior ML team (9 people)\n\nSignalForge remains fully remote-first and has no plans to open a physical office.",
    req: [
      "6+ years of ML engineering with strong NLP experience",
      "Track record shipping NLP models to production",
      "Comfort combining structured and unstructured data sources",
      "Experience mentoring junior ML engineers",
      "English fluent, fully remote team",
    ],
    pros: [
      "Continuita' diretta con esperienza gia' vista sullo stesso profilo presso SignalForge (ruolo precedente ML), azienda gia' apprezzata",
      "Ruolo di leadership tecnica su workstream NLP, buon salto di responsabilita'",
      "Compenso USD sopra media, full remote senza vincoli di sede",
    ],
    cons: [
      "Colloqui noti per essere articolati (5 step in candidature precedenti presso la stessa azienda)",
    ],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 6+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo di leadership tecnica sul workstream NLP, in continuita' diretta con un'esperienza gia' positiva presso la stessa azienda su una posizione precedente dello stesso profilo.",
    scoreNotes:
      "Eccellente continuita' di carriera presso un'azienda gia' vista con esito positivo, ruolo di leadership tecnica su NLP con compenso molto competitivo; punteggio tra i piu' alti del set.",
    criticNotes:
      "Round 1: 7.5/10, Round 2: 8/10, Round 3: 8/10. Verdict: PASS. Strength: CV mette in evidenza con precisione l'esperienza NLP di produzione e la capacita' di combinare feature strutturate/non strutturate, senza inventare claim su domini non coperti. Gap: mentoring formale di ML engineer junior limitato, presentato correttamente come esperienza informale.",
  },
  {
    title: "Senior React Native Engineer, Wallet Team",
    company: "Loopway",
    city: "barcelona",
    remote: "full_remote",
    sal: [64000, 82000, "EUR"],
    source: "Wellfound",
    status: "applied",
    score: 83,
    family: "Mobile",
    h: 153,
    critic: [7, "PASS"],
    jd: "Loopway runs a consumer mobility app (2M+ MAU), now expanding into an in-app wallet for payments and rewards. This Senior role joins the new four-person Wallet squad building the wallet UI/payment flows in React Native/TypeScript, including native module work for secure storage. Fully remote, distributed team, Series B and well-capitalized.",
    jdFull:
      "Loopway runs a consumer mobility app with over 2 million monthly active users, recently expanding into an in-app wallet for trip payments and loyalty rewards.\n\nThe Role\n\nWe are hiring a Senior React Native Engineer to join the new Wallet team, a four-person squad building the in-app payments and rewards experience from the ground up.\n\nWhat you'll do\n- Build the wallet UI and payment flows in React Native/TypeScript\n- Integrate with a new payments backend built specifically for the wallet feature\n- Write native modules where React Native's bridge isn't sufficient (mostly for secure storage)\n- Help define release and rollout strategy for a feature touching real money\n\nWhat we're looking for\n- 5+ years of mobile development, strong React Native experience\n- Experience with native modules (Swift/Kotlin bridge work)\n- Comfort with the added rigor required for payment-related features\n- Track record shipping consumer-facing mobile features at scale\n\nWhat we offer\n- Fully remote, the Wallet team is distributed across three countries\n- Above-market compensation for the payments specialization\n- Direct continuity with the core Loopway app (well-known product, 2M+ MAU) from prior experience with the company\n- Small, focused squad building a brand-new feature area\n\nLoopway is Series B, well-capitalized, expanding its product surface beyond core mobility.",
    req: [
      "5+ years of mobile development, strong React Native experience",
      "Experience with native modules (Swift/Kotlin bridge work)",
      "Comfort with the rigor required for payment-related features",
      "Track record shipping consumer mobile features at scale",
      "English fluent, distributed team across three countries",
    ],
    pros: [
      "Continuita' diretta con esperienza gia' positiva sullo stesso prodotto (Loopway), stavolta su un nuovo team ad alta visibilita'",
      "Compenso sopra media per la specializzazione payments",
      "Full remote gia' sperimentato positivamente con la stessa azienda",
    ],
    cons: [
      "Rigore aggiuntivo richiesto per feature che toccano denaro reale, maggiore complessita' di test e rilascio",
    ],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 5+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo su un nuovo team ad alta visibilita' in continuita' con un'esperienza gia' positiva sullo stesso prodotto, compenso sopra media per la specializzazione payments.\nNOTE_MISMATCH: [DOMAIN] Nessuna esperienza diretta su feature di pagamento in-app, area di apprendimento per il ruolo.",
    scoreNotes:
      "Ottima continuita' con un'azienda gia' apprezzata, ruolo su un nuovo team ad alta visibilita' con compenso sopra media; punteggio alto.",
    criticNotes:
      "Round 1: 6.5/10, Round 2: 7/10, Round 3: 7/10. Verdict: PASS. Strength: CV documenta chiaramente esperienza React Native e native modules pregressa, buon riferimento a shipping consumer-scale. Gap: nessuna esperienza diretta su feature di pagamento in-app, il CV la inquadra come area di apprendimento senza sovrastimare competenze non verificate.",
  },
  {
    title: "Senior Data Engineer, Ingestion",
    company: "Mosaic Cloud",
    city: "paris",
    remote: "hybrid",
    sal: [70000, 88000, "EUR"],
    source: "Welcome to the Jungle",
    status: "applied",
    score: 76,
    family: "Data",
    h: 165,
    critic: [7, "PASS"],
    jd: "Mosaic Cloud provides a customer data platform for mid-market SaaS companies. This Senior role leads a rework of the ingestion layer to handle schema evolution gracefully (Airflow, BigQuery), defining schema contracts with client sources and mentoring two mid-level data engineers. Hybrid, two days/week in Paris, 55-person Series B company.",
    jdFull:
      "Mosaic Cloud provides a customer data platform used by mid-market SaaS companies to unify product, marketing and billing data into a single source of truth.\n\nThe Role\n\nWe are hiring a Senior Data Engineer to lead a rework of our ingestion layer, which currently struggles with schema-change breakage from client source systems.\n\nWhat you'll do\n- Redesign our ingestion architecture to handle schema evolution gracefully (Airflow, BigQuery)\n- Define a schema-contract system between client sources and our transformation layer\n- Own reliability metrics for the ingestion pipeline (currently a known pain point internally)\n- Mentor two mid-level data engineers on the ingestion team\n\nWhat we're looking for\n- 6+ years of data engineering experience\n- Deep experience with schema evolution and data-contract patterns\n- Strong Airflow and BigQuery/dbt background\n- Experience mentoring engineers on a data team\n\nWhat we offer\n- Hybrid schedule, two days a week at our Paris office\n- Ownership of a known, high-priority reliability problem\n- Standard French benefits package\n- Continuity with the broader data platform team (candidate previously interviewed for an adjacent role here)\n\nMosaic Cloud is a 55-person Series B company, growing its enterprise client base.",
    req: [
      "6+ years of data engineering experience",
      "Deep experience with schema evolution and data-contract patterns",
      "Strong Airflow and BigQuery/dbt background",
      "Experience mentoring data engineers",
      "French or English working proficiency",
    ],
    pros: [
      "Seconda candidatura presso la stessa azienda, gia' nota al team dai colloqui precedenti",
      "Ruolo ad alta responsabilita' su un problema di affidabilita' gia' identificato come prioritario",
    ],
    cons: [
      "Esperienza specifica su pattern di data-contract formali limitata nel background del candidato",
      "Ibrido due giorni a settimana a Parigi",
    ],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 6+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: French or English\n\nRuolo ad alta responsabilita' su un problema di affidabilita' dell'ingestion gia' identificato come prioritario, con una seconda candidatura presso un'azienda gia' nota al team dai colloqui precedenti.\nNOTE_MISMATCH: [STACK] Esperienza specifica su pattern di data-contract formali limitata nel background del candidato, competenza chiave richiesta dal ruolo.",
    scoreNotes:
      "Buon fit generale su data engineering ma con un gap specifico sui data-contract pattern richiesti come competenza chiave per il ruolo; punteggio nella media alta con riserva.",
    criticNotes:
      "Round 1: 5/10, Round 2: 6/10, Round 3: 7/10. Verdict: PASS. Strength: le revisioni successive hanno aggiunto esempi concreti su schema evolution e negoziazione di contratti con i team a monte, rafforzando il caso attorno al gap iniziale. Gap: l'esperienza diretta su data-contract formali resta contenuta rispetto al ruolo, ma il CV la inquadra con onestita' come area di crescita recente anziche' sovrastimarla.",
    addr: "34 Avenue des Champs-Élysées, 75008 Paris",
  },
  {
    title: "Backend Reliability Engineer, Payments Platform",
    company: "FinPilot",
    city: "amsterdam",
    remote: "hybrid",
    sal: [76000, 96000, "EUR"],
    source: "LinkedIn",
    status: "response",
    score: 86,
    family: "Backend",
    h: 172,
    critic: [8, "PASS"],
    jd: "FinPilot is splitting a dedicated reliability function out of its payments-core team as transaction volume grows. This role owns incident response, SLOs, and alerting for settlement-critical paths, partnering with the team's Staff Backend Engineer to balance reliability work against feature delivery. Hybrid, two days/week in Amsterdam, 140-person profitable Series C company.",
    jdFull:
      "FinPilot builds payments infrastructure for European marketplaces. Following growth in transaction volume, the payments-core team is splitting out a dedicated reliability function.\n\nThe Role\n\nWe are hiring a Backend Reliability Engineer to focus specifically on the operational health of our settlement services, working alongside the existing payments-core engineers rather than replacing generalist backend work.\n\nWhat you'll do\n- Own incident response and postmortems for the payments-core services\n- Build out SLOs and alerting tuned to settlement-critical paths\n- Reduce on-call toil through targeted automation\n- Partner with the Staff Backend Engineer on the team to prioritize reliability work against feature delivery\n\nWhat we're looking for\n- 4+ years of backend engineering with meaningful ops/reliability exposure\n- Experience with Kafka-based event-driven systems\n- Comfort with financial or otherwise high-correctness domains\n- Strong incident-response and postmortem practice\n\nWhat we offer\n- Hybrid schedule, two days a week at our Amsterdam office (Zuidas)\n- Above-market compensation reflecting the criticality of the domain\n- Direct collaboration with the existing payments-core leadership (candidate has prior positive contact with this team)\n- Blameless postmortem culture, well established internally\n\nFinPilot is a 140-person company, Series C, profitable in its core European markets.",
    req: [
      "4+ years of backend engineering with meaningful ops/reliability exposure",
      "Experience with Kafka-based event-driven systems",
      "Comfort with financial or high-correctness domains",
      "Strong incident-response and postmortem practice",
      "English fluent",
    ],
    pros: [
      "Terzo contatto positivo con FinPilot (gia' vista due volte sullo stesso profilo), rapporto di fiducia gia' avviato col team",
      "Compenso sopra media per la criticita' del dominio",
      "Cultura di postmortem blameless gia' consolidata internamente",
    ],
    cons: ["Ibrido due giorni a settimana ad Amsterdam"],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 4+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo di reliability su servizi di pagamento ad alta correttezza, terzo contatto positivo con la stessa azienda dopo due candidature precedenti dello stesso profilo con esito favorevole.",
    scoreNotes:
      "Ottimo fit su affidabilita' backend in un dominio ad alta correttezza, ulteriormente rafforzato dal rapporto gia' costruito con l'azienda in candidature precedenti; punteggio alto e risposta ricevuta rapidamente.",
    criticNotes:
      "Round 1: 7/10, Round 2: 8/10, Round 3: 8/10. Verdict: PASS. Strength: CV coerente con le due candidature precedenti presso la stessa azienda, evidenzia bene esperienza di incident response su sistemi Kafka-based. Gap: metriche SLO formali gestite in autonomia ancora limitate, il CV le presenta come esperienza di supporto piuttosto che ownership piena.",
    addr: "Zuidas, Gustav Mahlerlaan 22, 1082 Amsterdam",
  },
  {
    title: "Junior WordPress Developer",
    company: "AgencyOne",
    city: "roma",
    remote: "onsite",
    sal: [24000, 29000, "EUR"],
    source: "Indeed",
    status: "excluded",
    score: 25,
    family: "Frontend",
    h: 260,
    jd: "AgencyOne is a Rome-based digital agency building WordPress sites for small local businesses. The role is entry-level: building/customizing sites with Elementor and light custom PHP, plus direct client revision handling and maintenance across ~40 client sites. Onsite, Rome, 8-person agency serving local SMBs.",
    jdFull:
      "AgencyOne is a digital agency in Rome building WordPress websites for small local businesses (restaurants, dentists, local retailers).\n\nThe Role\n\nWe are looking for a Junior WordPress Developer to join our small production team, building and customizing WordPress sites using page builders and light custom PHP.\n\nWhat you'll do\n- Build and customize WordPress sites using Elementor and similar page builders\n- Write light custom PHP for theme/plugin tweaks requested by clients\n- Handle client revision requests directly via email and phone\n- Manage hosting and basic maintenance for a portfolio of ~40 client sites\n\nWhat we're looking for\n- Basic WordPress and PHP knowledge\n- Comfort with page builders (Elementor, Divi)\n- Willingness to handle direct client communication on revisions\n- No formal degree required, portfolio matters more\n\nWhat we offer\n- Onsite role at our Rome office\n- Entry-level salary with room to grow into a mid-level role\n- Exposure to a wide variety of small-business client projects\n- Casual, small-team environment (8 people)\n\nAgencyOne has been operating in the Rome market for over a decade, serving primarily local SMB clients.",
    notes:
      "EXCLUDED: [STACK] Stack WordPress/PHP/page-builder senza alcuna sovrapposizione con lo stack moderno (React/TypeScript/Node) su cui e' costruito il profilo del candidato; nessun elemento di crescita tecnica rilevante.\n\nPosizione gia' scartata in passato per un profilo affine (Wordpress Webmaster presso la stessa azienda), confermando un pattern coerente di scarso fit. Compenso ampiamente sotto la soglia minima accettabile per il livello di esperienza del candidato.",
    scoreNotes:
      "Nessuna sovrapposizione con lo stack del candidato e compenso molto basso; esclusione confermata, coerente con un caso analogo gia' scartato in precedenza.",
    addr: "Via Nazionale 88, 00184 Roma",
  },
];
