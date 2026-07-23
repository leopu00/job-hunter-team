// [JHT-WEB-DEMO] Seed posizioni demo — persona "marketing" (56 posizioni).
// File generato: per rigenerarlo si passa dai JSON dello sciame di
// arricchimento e dal converter (23/07); a mano si edita come un normale
// array TS. L'ORDINE determina id/legacy_id: aggiungere solo in coda.
import type { Seed } from "../data";

export const MARKETING: Seed[] = [
  {
    title: "Growth Marketing Manager",
    company: "Northstar Labs",
    city: "berlin",
    remote: "full_remote",
    sal: [60000, 75000, "EUR"],
    source: "LinkedIn",
    status: "ready",
    score: 90,
    family: "Growth",
    h: 7,
    critic: [8, "PASS"],
    jd: "Northstar Labs is a Berlin-based B2B SaaS scale-up (Series B, ~120 people) selling workflow automation to mid-market ops teams. You will own the full acquisition funnel — paid, lifecycle and experimentation — reporting directly to the VP Marketing, leading a small squad of a designer and an analyst. Growth loops are still being built, so this is a build-and-own mandate, not a maintenance role.",
    jdFull:
      "Northstar Labs helps mid-market operations teams eliminate manual busywork with a no-code automation platform. We're a 120-person, fully distributed team backed by top-tier European VCs, growing ARR 3x year over year.\n\nThe Role\nWe're hiring a Growth Marketing Manager to own the full acquisition funnel — from paid channels to lifecycle nurture to in-product experimentation. You'll report to the VP Marketing and lead a squad of one designer and one analyst, with a dedicated monthly experiment budget.\n\nWhat You'll Do\n- Own paid acquisition across Google, LinkedIn and content syndication, with a quarterly budget north of €150k\n- Design and ship lifecycle campaigns across the trial-to-paid funnel\n- Run a structured experimentation program (2-3 tests live at any time) and report weekly to leadership\n- Partner with product on activation and onboarding flows\n- Build attribution and reporting in GA4 and our internal data warehouse\n\nWhat We're Looking For\n- 4+ years in growth or performance marketing, ideally B2B SaaS\n- Comfortable writing SQL to pull your own funnel data\n- A track record of running structured experiment programs, not just \"trying things\"\n\nWhat We Offer\n- Full remote across the EU, with quarterly team offsites in Berlin\n- A dedicated experimentation budget you control\n- A clear path to Head of Growth within 12-18 months for the right person",
    req: [
      "4+ years in growth or performance marketing roles, ideally B2B SaaS",
      "Hands-on with GA4, attribution modelling and SQL for self-serve reporting",
      "Track record of running structured A/B/experiment programs",
      "Experience managing paid budgets above €100k/quarter",
      "Comfortable leading a small cross-functional squad (design + analytics)",
    ],
    pros: [
      "Budget esperimenti dedicato e autonomia decisionale alta",
      "Full remote EU con offsite trimestrali a Berlino",
      "Percorso di carriera chiaro verso Head of Growth",
      "Stack dati moderno (GA4 + warehouse interno)",
    ],
    cons: [
      "Reporting settimanale al board, pressione sui numeri costante",
      "Team ancora piccolo: poco supporto operativo sulle attività meno strategiche",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 4+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo growth B2B SaaS in linea con il profilo del candidato: funnel ownership end-to-end, budget importante e team dedicato. Full remote EU senza barriere di visto, azienda in forte crescita (Series B, ARR 3x YoY). Nessun mismatch rilevante, verdetto GO.",
    scoreNotes:
      "Punteggio alto: fit quasi perfetto su seniority, stack (GA4/SQL) e ownership end-to-end del funnel; stipendio in target e remote pieno senza vincoli geografici.",
    criticNotes:
      "Round 2: 8/10. CV valorizza bene gli esperimenti growth pregressi e l'esperienza su budget paid comparabili; nessuna competenza inventata, solo enfasi su SQL self-serve già presente nel background.",
  },
  {
    title: "Content Strategist, B2B",
    company: "AtlasCare",
    city: "milano",
    remote: "hybrid",
    sal: [42000, 54000, "EUR"],
    source: "Wellfound",
    status: "ready",
    score: 83,
    family: "Content",
    h: 14,
    critic: [7, "PASS"],
    jd: "AtlasCare is a Milan-based healthtech scale-up building remote patient monitoring tools for clinics across Southern Europe. You'll own editorial strategy end-to-end — SEO content, clinical thought leadership and sales enablement assets — working closely with an in-house editorial team of two writers and a designer.",
    jdFull:
      "AtlasCare builds remote patient monitoring software used by 400+ clinics across Italy, Spain and Portugal. We're a 60-person team headquartered in Milan, growing our content function to support an increasingly technical, clinical audience.\n\nThe Role\nAs Content Strategist, B2B you'll define and execute our editorial strategy: long-form SEO content, thought leadership pieces co-authored with our clinical advisors, and sales enablement collateral for our commercial team.\n\nWhat You'll Do\n- Own the content calendar and editorial guidelines across blog, whitepapers and case studies\n- Brief and edit two in-house writers, plus manage freelance clinical reviewers\n- Partner with SEO and demand gen to prioritize topics by search and pipeline impact\n- Translate clinical research into accessible content for hospital procurement audiences\n\nRequirements\n- A portfolio of published long-form B2B content, ideally in healthtech, fintech or another regulated industry\n- Working knowledge of SEO fundamentals (keyword research, on-page structure)\n- Italian mother tongue with English at C1 for coordination with international stakeholders\n\nWhat We Offer\n- Hybrid setup, two days/week in our Milan office near Porta Romana\n- A dedicated in-house editorial team, not a one-person content function\n- High-impact subject matter: your work directly supports clinical adoption decisions",
    req: [
      "Portfolio of published long-form B2B content, ideally healthtech/fintech",
      "SEO fundamentals: keyword research, on-page structure",
      "Italian mother tongue, English C1",
      "Experience briefing and editing junior writers or freelancers",
      "Comfortable translating technical/clinical material for a business audience",
    ],
    pros: [
      "Team editoriale interno con due writer dedicati",
      "Tema ad alto impatto: contenuti che supportano decisioni cliniche reali",
      "Ufficio ben collegato a Milano (Porta Romana)",
    ],
    cons: [
      "Due giorni in ufficio a Milano obbligatori",
      "Dominio clinico richiede tempo di ramp-up sul lessico tecnico",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Italian + English\n\nRuolo content strategy allineato al percorso editoriale del candidato, con portfolio B2B già validato. Settore healthtech è adiacente ma non identico ai precedenti settori coperti dal candidato.\nNOTE_MISMATCH: [DOMAIN] Nessuna esperienza diretta in ambito clinico/healthtech, solo settori B2B generici.",
    scoreNotes:
      "Buon punteggio: profilo editoriale solido e lingua italiana nativa richiesta soddisfatta pienamente; lieve incertezza sul dominio clinico specifico, compensata dal portfolio B2B ampio.",
    criticNotes:
      "Round 2: 7/10. Il CV mette in evidenza il portfolio long-form esistente e la gestione di calendari editoriali; il gap sul dominio clinico è dichiarato esplicitamente come area di apprendimento, nessuna esperienza clinica inventata.",
    addr: "Via Orazio 45, 20139 Milano",
  },
  {
    title: "Performance Marketing Lead",
    company: "Loopway",
    city: "barcelona",
    remote: "full_remote",
    sal: [55000, 70000, "EUR"],
    source: "Otta",
    status: "ready",
    score: 86,
    family: "Performance Ads",
    h: 22,
    critic: [8, "PASS"],
    jd: "Loopway is a consumer social app with 2M monthly active users, based out of Barcelona but hiring fully remote across the EU. You'll own paid budgets across Meta, Google and TikTok (~€400k/month), build out the creative testing pipeline and lead incrementality measurement with the data team.",
    jdFull:
      "Loopway is a consumer social app connecting people through shared interests, with 2M MAU and growing 15% month over month. We're a lean 40-person team, remote-first, with a hub in Barcelona for those who want an office.\n\nThe Role\nAs Performance Marketing Lead you'll own paid acquisition end-to-end: budget allocation across Meta, Google and TikTok (roughly €400k/month), creative testing velocity, and proving incrementality beyond last-click attribution.\n\nWhat You'll Do\n- Manage and optimize ~€400k/month across Meta, Google UAC and TikTok\n- Build and run a high-velocity creative testing pipeline (10+ concepts/week)\n- Partner with the data team on MMM and incrementality testing\n- Set and own CAC targets by channel and cohort\n- Present monthly performance reviews directly to the founders\n\nWhat We're Looking For\n- Experience managing six-figure monthly budgets in a consumer app context\n- A structured approach to creative testing frameworks\n- Exposure to incrementality testing or marketing mix modeling (MMM)\n\nWhat We Offer\n- Full remote across the EU, no fixed hours as long as overlap with CET\n- Real budget ownership and creative freedom — we don't do committee-approved ads\n- Bonus tied directly to CAC targets, not vanity metrics",
    req: [
      "Managed six-figure monthly paid budgets in a consumer/app context",
      "Structured creative testing frameworks (concept velocity, hypothesis-driven)",
      "Exposure to incrementality testing or MMM",
      "Hands-on with Meta Ads Manager, Google UAC and TikTok Ads",
      "Comfortable presenting performance directly to founders/leadership",
    ],
    pros: [
      "Budget importante (~€400k/mese) e piena libertà creativa",
      "Bonus legato a target di CAC, non a vanity metrics",
      "Full remote EU senza vincoli di orario fissi",
    ],
    cons: [
      "Pressione forte sui numeri trimestrali, review dirette con i founder",
      "Ritmo di test molto alto (10+ concept/settimana) può essere logorante",
    ],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 5+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nProfilo con esperienza comparabile su budget a sei cifre e app consumer, buon fit sui canali richiesti (Meta/Google/TikTok). L'esposizione a MMM è marginale nel background del candidato ma presente come nice-to-have nell'annuncio.\nNOTE_MISMATCH: [STACK] Esperienza diretta di MMM/incrementality testing limitata, principalmente attribuzione last-click nei ruoli precedenti.",
    scoreNotes:
      "Punteggio alto: fit forte su gestione budget performance e canali paid richiesti; unico gap è l'esperienza di incrementality testing, marginale rispetto al peso del ruolo.",
    criticNotes:
      "Round 2: 8/10. Il CV enfatizza la gestione di budget comparabili e i risultati su CAC ottenuti in ruoli precedenti; sull'incrementality testing si è scelto di essere onesti, citando solo l'esposizione teorica senza inventare progetti MMM mai condotti.",
  },
  {
    title: "CRM & Lifecycle Manager",
    company: "FinPilot",
    city: "amsterdam",
    remote: "hybrid",
    sal: [50000, 64000, "EUR"],
    source: "LinkedIn",
    status: "ready",
    score: 81,
    family: "CRM & Email",
    h: 30,
    critic: [7, "PASS"],
    jd: "FinPilot is an Amsterdam-based fintech with 800k users, building a personal finance app for freelancers. You'll own Braze journeys, segmentation strategy and retention KPIs, working closely with product and data teams in a regulated environment.",
    jdFull:
      "FinPilot helps freelancers across the EU manage taxes, invoicing and savings from a single app, serving 800k users and growing. We're a 90-person fintech based in Amsterdam, regulated by the Dutch central bank, with a strong focus on trust and compliance.\n\nThe Role\nAs CRM & Lifecycle Manager you'll own our Braze instance end-to-end: journey design, segmentation, and the retention KPIs that matter to the business (D30 retention, reactivation rate, upsell to premium tier).\n\nWhat You'll Do\n- Design and maintain lifecycle journeys across onboarding, activation and retention in Braze\n- Build audience segments using SQL against our data warehouse\n- Run structured A/B tests on messaging, timing and channel mix\n- Partner with legal/compliance on every campaign given our regulated status\n- Report retention KPIs monthly to the leadership team\n\nRequirements\n- Hands-on experience with Braze or a comparable platform (Iterable, Customer.io)\n- Strong segmentation and A/B testing discipline\n- Working SQL for audience building and reporting\n\nWhat We Offer\n- Hybrid role, two days/week in our Amsterdam office\n- A modern CRM stack with a dedicated data team supporting you\n- Direct exposure to retention economics in a regulated fintech",
    req: [
      "Hands-on Braze or comparable ESP (Iterable, Customer.io)",
      "Strong segmentation and A/B testing discipline",
      "SQL for audience building and reporting",
      "Comfortable working within a regulated/compliance-heavy environment",
      "Experience owning retention KPIs (D30, reactivation, upsell)",
    ],
    pros: [
      "Stack CRM moderno (Braze) già padroneggiato dal candidato",
      "Team data di supporto per segmentazione avanzata",
      "KPI di retention chiari e misurabili",
    ],
    cons: [
      "Dominio regolamentato: ogni campagna richiede approvazione legale/compliance",
      "Tempi di iterazione più lenti rispetto a un contesto non regolamentato",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3-5 years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nOttimo allineamento sullo stack CRM (Braze) e sulla disciplina di segmentazione/A-B testing del candidato. Il contesto fintech regolamentato è nuovo ma non bloccante, dato il background su prodotti data-driven simili.",
    scoreNotes:
      "Punteggio solido: match diretto su piattaforma CRM e competenze SQL richieste; lieve incertezza sui tempi di approvazione compliance ma non impatta il fit tecnico.",
    criticNotes:
      "Round 2: 7/10. Il CV mette in risalto l'esperienza diretta su Braze e la costruzione di journey di retention comparabili; nessuna esperienza fintech pregressa dichiarata come tale, evitando di sovrastimare l'expertise regolatoria.",
    addr: "Herengracht 182, 1016 Amsterdam",
  },
  {
    title: "Brand Marketing Manager",
    company: "Studio Relay",
    city: "firenze",
    remote: "hybrid",
    sal: [45000, 58000, "EUR"],
    source: "LinkedIn",
    status: "applied",
    score: 80,
    family: "Brand",
    h: 85,
    critic: [7, "PASS"],
    jd: "Studio Relay is a Florence-based design studio turned product company, running brand campaigns, partnerships and events across EU markets. You'll shape brand voice and lead integrated campaigns spanning digital, print and live events.",
    jdFull:
      "Studio Relay started as a design studio and has grown into a design-led product company with clients and users across Southern Europe. Based in the heart of Florence, we're a 35-person team that treats brand as a product in itself.\n\nThe Role\nAs Brand Marketing Manager you'll own brand campaigns end-to-end, from concept to execution, across EU markets — including partnerships and live events.\n\nWhat You'll Do\n- Develop and execute integrated brand campaigns across digital, print and events\n- Manage partnership marketing with complementary design and product brands\n- Plan and run 4-6 live events per year across EU cities\n- Maintain brand guidelines and voice consistency across all touchpoints\n- Collaborate closely with the founder-led creative team\n\nWhat We're Looking For\n- Experience running integrated brand campaigns across multiple channels\n- Comfortable managing external partners and event logistics\n- A strong eye for design-led brand storytelling\n\nWhat We Offer\n- Hybrid role based in our Florence studio, two days/week\n- Direct collaboration with a founder-led creative team\n- Travel budget for EU events",
    req: [
      "Experience running integrated brand campaigns (digital + print + events)",
      "Comfortable managing external partners and vendor relationships",
      "Event planning and on-site logistics experience",
      "Strong eye for design-led brand storytelling",
      "Fluent English for EU market coordination",
    ],
    pros: [
      "Collaborazione diretta con il team creativo fondatore",
      "Budget viaggi per eventi EU",
      "Ambiente design-led con alta cura del brand",
    ],
    cons: ["Studio piccolo, poca struttura di processo formale"],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 4+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo brand a tutto tondo che valorizza l'esperienza del candidato su campagne integrate ed eventi EU. Studio piccolo e founder-led, buon fit culturale con profili autonomi.",
    scoreNotes:
      "Punteggio buono: esperienza pregressa su campagne brand integrate e gestione eventi corrisponde bene alle richieste; struttura aziendale piccola comporta meno supporto di processo.",
    criticNotes:
      "Round 2: 7/10. Il CV valorizza i case study di campagne brand ed eventi gestiti in autonomia; nessuna esperienza di design studio dichiarata direttamente, il fit resta sul lato marketing/eventi.",
    addr: "Via de' Tornabuoni 12, 50123 Firenze",
  },
  {
    title: "Demand Generation Specialist",
    company: "Mosaic Cloud",
    city: "paris",
    remote: "hybrid",
    sal: [48000, 60000, "EUR"],
    source: "Welcome to the Jungle",
    status: "applied",
    score: 78,
    family: "Growth",
    h: 115,
    critic: [7, "PASS"],
    jd: "Mosaic Cloud is a Paris-based B2B cloud infrastructure vendor selling to mid-market engineering teams. You'll build and scale demand generation programs — webinars, content syndication, ABM — feeding a growing outbound and inbound sales pipeline.",
    jdFull:
      "Mosaic Cloud provides managed cloud infrastructure for mid-market engineering teams who don't want to run their own ops. We're a 150-person company headquartered in Paris, with sales teams across France, Germany and the UK.\n\nThe Role\nAs Demand Generation Specialist you'll build and run programs that fill sales pipeline: webinars, content syndication, paid social and account-based marketing for our top 200 target accounts.\n\nWhat You'll Do\n- Plan and execute quarterly demand gen campaigns aligned with sales targets\n- Run webinar and content syndication programs with third-party partners\n- Build ABM plays for our top 200 target account list\n- Track and report MQL-to-SQL conversion with the RevOps team\n- Collaborate with sales on lead scoring and handoff criteria\n\nRequirements\n- Experience running B2B demand generation programs (webinars, syndication, ABM)\n- Comfortable working with a CRM (Salesforce or HubSpot) and lead scoring models\n- French or English fluency, ideally both\n\nWhat We Offer\n- Hybrid role, three days/week in our Paris office near République\n- Clear MQL/SQL targets with quarterly bonus tied to pipeline generated\n- Structured onboarding into our RevOps process",
    req: [
      "Experience running B2B demand generation programs (webinars, syndication, ABM)",
      "Comfortable with Salesforce or HubSpot and lead scoring models",
      "Account-based marketing experience for enterprise/mid-market targets",
      "French or English fluency",
      "Track record of hitting MQL/SQL pipeline targets",
    ],
    pros: [
      "Target MQL/SQL chiari con bonus trimestrale legato alla pipeline",
      "Onboarding strutturato nel processo RevOps",
    ],
    cons: [
      "Tre giorni obbligatori in ufficio a Parigi",
      "Forte dipendenza dal ciclo vendite enterprise, meno controllo sui risultati finali",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: French + English\n\nRuolo demand gen B2B in linea con l'esperienza pregressa del candidato su programmi ABM e webinar. Il requisito di francese fluente non è confermato nel profilo del candidato.\nNOTE_MISMATCH: [LANGUAGE] Francese richiesto come plus, il candidato ha solo inglese fluente dichiarato.",
    scoreNotes:
      "Punteggio discreto: solida esperienza su programmi demand gen e ABM, ma il mismatch linguistico sul francese pesa leggermente sul fit per un ruolo ibrido a Parigi.",
    criticNotes:
      "Round 2: 7/10. Il CV mette in evidenza i programmi ABM e i risultati su pipeline generata in ruoli precedenti; non si dichiara competenza in francese, evitando di sovrastimare la fluidità linguistica.",
    addr: "Rue du Faubourg du Temple 22, 75011 Paris",
  },
  {
    title: "Social Media Manager",
    company: "Snapdeck",
    city: "copenhagen",
    remote: "full_remote",
    sal: [40000, 52000, "EUR"],
    source: "Otta",
    status: "response",
    score: 75,
    family: "Content",
    h: 170,
    critic: [6, "PASS"],
    jd: "Snapdeck is a Copenhagen-headquartered consumer social app for short-form video, growing fast across the Nordics and DACH. You'll own organic social strategy across TikTok, Instagram and YouTube Shorts, working with an in-house creator team.",
    jdFull:
      "Snapdeck is building a short-form video app tailored to Nordic and DACH audiences, with 500k downloads since launch six months ago. We're a 25-person startup based in Copenhagen, fully remote-friendly.\n\nThe Role\nAs Social Media Manager you'll own our organic social presence — TikTok, Instagram Reels and YouTube Shorts — working with two in-house creators and a network of freelance talent.\n\nWhat You'll Do\n- Plan and execute the organic content calendar across TikTok, Instagram and YouTube\n- Brief and coordinate in-house and freelance creators\n- Monitor trends and adapt content formats quickly (same-week turnaround)\n- Track engagement, follower growth and content-to-app-install conversion\n- Represent the brand voice in community replies and DMs\n\nWhat We're Looking For\n- Proven track record growing organic social channels for a consumer brand\n- Comfortable briefing and directing creators, not just posting content\n- Fast-paced, trend-aware content instinct\n\nWhat We Offer\n- Full remote across the EU\n- Direct ownership of channels with 500k+ combined followers\n- A young, fast-moving team with real creative freedom",
    req: [
      "Proven track record growing organic social channels for a consumer app",
      "Experience briefing and directing creators (in-house or freelance)",
      "Fast content turnaround, comfortable with trend-driven formats",
      "Familiarity with TikTok/Reels analytics and reporting",
      "English fluency for a Nordic/DACH audience mix",
    ],
    pros: [
      "Ownership diretto di canali con oltre 500k follower combinati",
      "Team giovane e veloce con vera libertà creativa",
      "Full remote EU senza vincoli di sede",
    ],
    cons: [
      "Ritmo molto veloce, richiede reattività ai trend quasi quotidiana",
      "Startup piccola con poca struttura di processo",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2-4 years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nBuon fit sulla gestione organica di canali social consumer, in linea con i risultati precedenti del candidato. Il ritmo trend-driven richiesto è più rapido di quanto sperimentato nei ruoli passati.\nNOTE_MISMATCH: [SENIORITY] Il ruolo richiede reattività quasi quotidiana ai trend, ritmo superiore alle esperienze precedenti del candidato in contesti più strutturati.",
    scoreNotes:
      "Punteggio nella media: buona esperienza social organica ma il ritmo trend-driven richiesto è più intenso di quanto gestito finora dal candidato.",
    criticNotes:
      "Round 2: 6/10. Il CV valorizza la crescita di canali organici ottenuta in ruoli precedenti; il ritmo trend-driven quotidiano richiesto resta un'area di crescita dichiarata esplicitamente, senza inventare esperienze specifiche su TikTok trend-jacking.",
  },
  {
    title: "SEO Manager",
    company: "Pipebase",
    remote: "full_remote",
    sal: [50000, 65000, "EUR"],
    source: "Company site",
    status: "writing",
    score: 84,
    family: "Content",
    h: 32,
    wr: true,
    jd: "Pipebase is a B2B SaaS with a strong inbound motion, serving data engineering teams. You'll own technical SEO end-to-end — programmatic landing pages, content ops workflows and organic growth reporting — for a product with an already sizeable organic footprint.",
    jdFull:
      "Pipebase builds data pipeline tooling for engineering teams, with organic search already driving 40% of new signups. We're a 55-person, fully remote company with contributors across 12 countries.\n\nThe Role\nAs SEO Manager you'll own technical SEO and content ops: programmatic landing pages for our integration library, site architecture, and the editorial workflow that keeps our blog and docs performing in search.\n\nWhat You'll Do\n- Audit and improve technical SEO (crawlability, site speed, structured data)\n- Build and scale programmatic landing pages for our 200+ integrations\n- Own the content ops process: briefs, editorial calendar, freelance writer network\n- Report organic traffic, keyword rankings and signup attribution monthly\n- Partner with product marketing on launch-related SEO\n\nRequirements\n- Proven technical SEO experience (crawl budgets, structured data, Core Web Vitals)\n- Experience building or scaling programmatic SEO pages\n- Comfortable managing a freelance writer network and content ops workflow\n\nWhat We Offer\n- Fully remote, async-friendly culture across time zones\n- Direct ownership of a channel already driving 40% of signups\n- Quarterly in-person team offsites",
    req: [
      "Proven technical SEO experience (crawl budgets, structured data, Core Web Vitals)",
      "Experience building or scaling programmatic SEO pages",
      "Comfortable managing a freelance writer network and editorial calendar",
      "Working knowledge of SQL for organic traffic/signup attribution reporting",
      "Familiarity with B2B SaaS content and developer audiences",
    ],
    pros: [
      "Canale organico già maturo (40% delle signup)",
      "Autonomia piena su architettura SEO e content ops",
      "Cultura full remote asincrona, offsite trimestrali",
    ],
    cons: [
      "Team piccolo: nessun supporto SEO dedicato oltre al ruolo stesso",
      "Programmatic SEO su 200+ integrazioni richiede disciplina tecnica alta",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3-5 years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nOttimo allineamento tecnico su SEO e programmatic pages con l'esperienza pregressa del candidato in contesti B2B SaaS. Nessun vincolo geografico, ruolo full remote asincrono.",
    scoreNotes:
      "Punteggio alto: competenze tecniche SEO e programmatic pages corrispondono bene al ruolo; canale già maturo riduce il rischio di execution.",
  },
  {
    title: "Marketing Automation Specialist",
    company: "NovaPay",
    city: "dublin",
    remote: "hybrid",
    sal: [45000, 58000, "EUR"],
    source: "Wellfound",
    status: "writing",
    score: 73,
    family: "CRM & Email",
    h: 46,
    wr: true,
    jd: "NovaPay is a Dublin-based payments fintech building automation workflows across the customer lifecycle. You'll implement and optimize marketing automation in HubSpot, working closely with sales and product to drive lead nurture and cross-sell.",
    jdFull:
      "NovaPay provides embedded payments infrastructure for e-commerce platforms across the UK and Ireland, processing over €2B annually. We're a 70-person fintech based in Dublin, with a growing marketing function.\n\nThe Role\nAs Marketing Automation Specialist you'll own our HubSpot instance: lead nurture workflows, lifecycle scoring, and the automation that connects marketing to sales handoff.\n\nWhat You'll Do\n- Build and maintain nurture workflows across the trial-to-close funnel in HubSpot\n- Own lead scoring model in partnership with sales and RevOps\n- Set up and maintain integrations between HubSpot, Salesforce and the product data warehouse\n- Run A/B tests on email sequences and landing page automation\n- Document and maintain automation processes for the wider marketing team\n\nRequirements\n- Hands-on HubSpot experience (workflows, lead scoring, reporting)\n- Comfortable working with CRM integrations (Salesforce a plus)\n- Basic SQL or willingness to learn for reporting\n\nWhat We Offer\n- Hybrid role, two days/week in our Dublin office\n- Direct exposure to fintech lead-to-cash processes\n- Structured onboarding with a dedicated RevOps mentor",
    req: [
      "Hands-on HubSpot experience (workflows, lead scoring, reporting)",
      "Comfortable with CRM integrations, Salesforce a plus",
      "Basic SQL or strong willingness to learn for reporting",
      "Experience running A/B tests on email/lifecycle automation",
      "Process-oriented, comfortable documenting workflows for a team",
    ],
    pros: [
      "Esposizione diretta a processi fintech lead-to-cash",
      "Onboarding strutturato con mentor RevOps dedicato",
    ],
    cons: [
      "Stack CRM (Salesforce) meno familiare rispetto a HubSpot per il candidato",
      "Ruolo molto operativo, meno spazio strategico nel breve termine",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2-4 years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nBuon fit su HubSpot e workflow di marketing automation, esperienza pregressa comparabile. L'integrazione con Salesforce è meno presente nel background del candidato.\nNOTE_MISMATCH: [STACK] Esperienza diretta con Salesforce limitata, il candidato ha lavorato principalmente con HubSpot standalone.",
    scoreNotes:
      "Punteggio nella media-alta: solida base HubSpot ma gap sull'integrazione Salesforce, che nel ruolo ha un peso operativo significativo.",
    addr: "Grand Canal Quay 4, Dublin 2",
  },
  {
    title: "Product Marketing Manager",
    company: "Brightline",
    city: "london",
    remote: "full_remote",
    sal: [55000, 72000, "GBP"],
    source: "Otta",
    status: "review",
    score: 82,
    family: "Product Marketing",
    h: 55,
    jd: "Brightline is a dev-tools company building CI/CD infrastructure for platform teams. You'll own positioning, launches and sales enablement, working closely with product management and a small but growing sales team.",
    jdFull:
      "Brightline builds CI/CD infrastructure trusted by platform teams at fast-growing tech companies. We're a 90-person, remote-first company with roots in London, selling to a highly technical developer audience.\n\nThe Role\nAs Product Marketing Manager you'll own positioning and messaging, lead product launches end-to-end, and build the sales enablement materials our small AE team relies on.\n\nWhat You'll Do\n- Define positioning and messaging for our core platform and each new feature launch\n- Run launch process end-to-end: internal alignment, external comms, sales readiness\n- Build sales enablement assets: battlecards, demo scripts, objection handling\n- Conduct win/loss interviews and translate findings into messaging updates\n- Partner closely with product management on the roadmap-to-market process\n\nWhat We're Looking For\n- Experience in product marketing for a technical/developer-facing product\n- Comfortable running launches end-to-end, not just writing copy\n- Strong written communication for a highly technical audience\n\nWhat We Offer\n- Full remote, UK-based legal entity with flexible hours\n- Direct access to founders and product leadership\n- Competitive salary with equity",
    req: [
      "Product marketing experience for a technical/developer-facing product",
      "Experience running product launches end-to-end",
      "Strong written communication for a highly technical audience",
      "Comfortable building sales enablement assets (battlecards, demos)",
      "Experience conducting win/loss analysis",
    ],
    pros: [
      "Accesso diretto a founder e leadership di prodotto",
      "Prodotto tecnico allineato a un pubblico developer, coerente col background",
      "Full remote con orari flessibili",
    ],
    cons: [
      "Team sales ancora piccolo, poco materiale di enablement pregresso da cui partire",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3-5 years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo di product marketing per pubblico developer, buon allineamento con l'esperienza del candidato su prodotti tecnici. Nessuna barriera geografica, entità legale UK ma lavoro full remote.",
    scoreNotes:
      "Punteggio buono: esperienza di product marketing tecnico e gestione launch end-to-end corrisponde bene alle richieste del ruolo.",
  },
  {
    title: "Event Marketing Manager",
    company: "Helvetia Systems",
    city: "zurich",
    remote: "hybrid",
    sal: [80000, 95000, "CHF"],
    source: "LinkedIn",
    status: "review",
    score: 77,
    family: "Brand",
    h: 62,
    jd: "Helvetia Systems is a Zurich-based enterprise software vendor serving banks and insurers across DACH. You'll plan and run the company's flagship conference plus a calendar of regional events, working with sales on pipeline-driving field marketing.",
    jdFull:
      "Helvetia Systems provides core banking and insurance software to enterprise clients across Switzerland, Germany and Austria. We're a 200-person company headquartered in Zurich, with a strong enterprise sales motion that relies heavily on in-person events.\n\nThe Role\nAs Event Marketing Manager you'll own our events calendar end-to-end: our 800-attendee flagship conference, regional roadshows, and sponsored industry events across DACH.\n\nWhat You'll Do\n- Plan and execute our annual flagship conference (800+ attendees, Zurich)\n- Run a calendar of regional roadshows and sponsored third-party events\n- Manage vendor relationships: venues, AV, catering, booth production\n- Partner with sales on event-sourced pipeline tracking and follow-up\n- Own the events budget (CHF 400k+ annually)\n\nRequirements\n- Experience planning and executing large-scale corporate events (500+ attendees)\n- Comfortable managing vendor relationships and on-site logistics\n- Experience with enterprise B2B sales cycles and pipeline attribution\n- German language skills a strong plus for DACH market coordination\n\nWhat We Offer\n- Hybrid role, two days/week in our Zurich office\n- Significant events budget with real decision-making autonomy\n- Swiss compensation package with strong benefits",
    req: [
      "Experience planning large-scale corporate events (500+ attendees)",
      "Comfortable managing vendors, venues and on-site logistics",
      "Experience with enterprise B2B sales cycles and event pipeline attribution",
      "German language skills a strong plus for DACH coordination",
      "Budget ownership experience (CHF 300k+)",
    ],
    pros: [
      "Budget eventi significativo (CHF 400k+) con autonomia decisionale",
      "Pacchetto retributivo svizzero solido",
    ],
    cons: [
      "Tedesco fluente fortemente preferito, non solo inglese",
      "Calendario eventi molto denso, alta componente di viaggio",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 4+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: German + English\n\nEsperienza di eventi corporate su larga scala in linea col profilo, ma la coordinazione DACH richiede tedesco fluente non confermato nel background del candidato.\nNOTE_MISMATCH: [LANGUAGE] Tedesco fluente fortemente preferito per il mercato DACH, il candidato dichiara solo inglese professionale.",
    scoreNotes:
      "Punteggio nella media: solida esperienza eventi ma il gap linguistico sul tedesco pesa su un ruolo fortemente orientato al mercato DACH.",
    addr: "Bahnhofstrasse 87, 8001 Zürich",
  },
  {
    title: "Paid Social Specialist",
    company: "MarketNest",
    city: "roma",
    remote: "hybrid",
    sal: [32000, 42000, "EUR"],
    source: "Indeed",
    status: "scored",
    score: 62,
    family: "Performance Ads",
    h: 72,
    jd: "MarketNest is a Rome-based digital marketing agency running paid social campaigns for SME clients across fashion, food and hospitality. You'll manage multiple client accounts on Meta and TikTok Ads, balancing creative testing with tight client budgets.",
    jdFull:
      "MarketNest is a 20-person digital agency based in Rome, managing paid social for a portfolio of 15+ SME clients in fashion, food and hospitality. Budgets are smaller than enterprise but the variety of accounts is high.\n\nThe Role\nAs Paid Social Specialist you'll manage Meta and TikTok Ads campaigns across a portfolio of client accounts, balancing creative testing with the tighter budgets typical of SME clients.\n\nWhat You'll Do\n- Manage and optimize paid social campaigns across 6-8 client accounts\n- Run creative testing within limited monthly budgets (€2-10k/client)\n- Prepare monthly reporting decks for client review calls\n- Coordinate with in-house designers on ad creative production\n- Support new business pitches with paid social projections\n\nRequirements\n- Hands-on experience with Meta Ads Manager and TikTok Ads\n- Comfortable managing multiple client accounts simultaneously\n- Client-facing communication skills for reporting calls\n\nWhat We Offer\n- Hybrid role, three days/week in our Rome office\n- Varied portfolio of clients and industries\n- Growth path toward Senior Paid Social within the agency",
    req: [
      "Hands-on Meta Ads Manager and TikTok Ads experience",
      "Comfortable managing multiple client accounts with varied budgets",
      "Client-facing reporting and communication skills",
      "Experience working within tight SME budgets (€2-10k/month per account)",
      "Basic design brief writing for ad creative",
    ],
    pros: [
      "Portfolio clienti vario, buona esposizione a settori diversi",
      "Percorso di crescita interno verso ruolo senior",
    ],
    cons: [
      "Budget per cliente molto limitati, poco spazio di test ambizioso",
      "Gestione simultanea di 6-8 account può essere dispersiva",
    ],
    notes:
      "SENIORITY_JD: junior\nEXPERIENCE_REQUIRED: 1-3 years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Italian + English\n\nRuolo agency con budget contenuti per cliente, in linea con esperienza junior/mid del candidato su Meta e TikTok Ads. Il carico di gestione multi-account è superiore a quanto gestito in ruoli precedenti.\nNOTE_MISMATCH: [SENIORITY] Gestione simultanea di 6-8 account clienti, il candidato ha esperienza su un numero inferiore di account in parallelo.",
    scoreNotes:
      "Punteggio nella media: competenze paid social di base coerenti ma il carico multi-account e i budget ridotti limitano il potenziale di crescita del ruolo.",
  },
  {
    title: "Copywriter, Tech",
    company: "Weblab Italia",
    city: "bologna",
    remote: "hybrid",
    sal: [28000, 36000, "EUR"],
    source: "Indeed",
    status: "scored",
    score: 57,
    family: "Content",
    h: 86,
    jd: "Weblab Italia is a Bologna-based web agency building websites and product content for Italian SMEs and startups. You'll write website copy, product descriptions and light SEO content across a variety of client industries.",
    jdFull:
      "Weblab Italia is a 15-person web agency in Bologna, building websites and digital content for Italian SMEs, startups and local retailers. Projects are fast-turnaround and varied.\n\nThe Role\nAs Copywriter, Tech you'll write website copy, product pages and light SEO blog content across a rotating portfolio of client projects.\n\nWhat You'll Do\n- Write homepage, landing page and product copy for client websites\n- Produce SEO-optimized blog content for client blogs (2-3 posts/week across accounts)\n- Collaborate with designers on copy-led page layouts\n- Support client calls to gather tone-of-voice and brief requirements\n\nRequirements\n- Portfolio of website and marketing copy in Italian\n- Basic SEO writing knowledge (keyword placement, meta descriptions)\n- Comfortable with fast turnaround and varied client briefs\n\nWhat We Offer\n- Hybrid role, two days/week in our Bologna office\n- Varied portfolio across many small clients\n- Entry point into a wider range of marketing disciplines over time",
    req: [
      "Portfolio of website and marketing copy in Italian",
      "Basic SEO writing knowledge (keywords, meta descriptions)",
      "Comfortable with fast turnaround and varied client briefs",
      "Italian mother tongue, basic English for occasional international clients",
    ],
    pros: [
      "Buon punto di ingresso per ampliare competenze su più discipline marketing",
      "Portfolio vario su molti piccoli clienti",
    ],
    cons: [
      "Salario nella fascia bassa per il mercato",
      "Ritmo di produzione alto su brief molto eterogenei",
    ],
    notes:
      "SENIORITY_JD: junior\nEXPERIENCE_REQUIRED: 1-2 years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Italian\n\nRuolo copywriting entry-level in agenzia, compatibile con il profilo del candidato ma sotto il livello di seniority e retribuzione target.\nNOTE_MISMATCH: [SALARY] Fascia salariale 28-36k EUR sotto il target atteso per il livello di esperienza del candidato.",
    scoreNotes:
      "Punteggio basso-medio: competenze di copywriting adeguate ma ruolo junior con salario sotto le aspettative del candidato per il livello di esperienza.",
  },
  {
    title: "Growth Analyst",
    company: "Cargolane",
    city: "hamburg",
    remote: "hybrid",
    sal: [45000, 56000, "EUR"],
    source: "StepStone",
    status: "scored",
    score: 68,
    family: "Growth",
    h: 98,
    jd: "Cargolane is a Hamburg-based logistics tech company optimizing freight booking for SME shippers. You'll support the growth team with funnel analysis, experiment design and reporting, working closely with a small performance marketing squad.",
    jdFull:
      "Cargolane digitizes freight booking for small and mid-size shippers across Northern Europe, processing thousands of bookings monthly. We're a 60-person logistics tech company based in Hamburg.\n\nThe Role\nAs Growth Analyst you'll support the growth team with data: funnel analysis, experiment design, and reporting that informs where the team invests next.\n\nWhat You'll Do\n- Build and maintain funnel dashboards across acquisition and activation\n- Design and analyze A/B tests run by the growth team\n- Support monthly reporting to leadership on growth KPIs\n- Partner with performance marketing on channel-level ROI analysis\n\nRequirements\n- Strong SQL skills for building and querying dashboards\n- Experience analyzing A/B test results (statistical significance, sample sizing)\n- Comfortable working with tools like Amplitude, Mixpanel or similar\n\nWhat We Offer\n- Hybrid role, two days/week in our Hamburg office\n- Close collaboration with a small, focused growth team\n- Direct visibility of your analysis in leadership decisions",
    req: [
      "Strong SQL skills for dashboards and ad-hoc analysis",
      "Experience analyzing A/B test results (significance, sample sizing)",
      "Comfortable with product analytics tools (Amplitude, Mixpanel or similar)",
      "Basic understanding of paid acquisition metrics (CAC, ROAS)",
      "Clear written communication for cross-functional reporting",
    ],
    pros: [
      "Ruolo molto analitico, coerente con le competenze SQL del candidato",
      "Team growth piccolo e focalizzato, alta visibilità del lavoro svolto",
    ],
    cons: [
      "Settore logistica meno familiare rispetto ai settori precedenti del candidato",
      "Ruolo di supporto, meno ownership diretta sulle decisioni finali",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2-4 years\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: English\n\nForte allineamento sulle competenze SQL e di analisi A/B test richieste. Il settore logistica è nuovo per il candidato ma il ruolo è prevalentemente analitico e trasferibile.\nNOTE_MISMATCH: [DOMAIN] Nessuna esperienza pregressa nel settore logistica, dominio nuovo da apprendere.",
    scoreNotes:
      "Punteggio nella media: competenze analitiche solide e trasferibili, ma il dominio logistico nuovo e il ruolo di supporto (non ownership) limitano il punteggio.",
  },
  {
    title: "Email Marketing Specialist",
    company: "Fluxwave",
    remote: "full_remote",
    sal: [38000, 48000, "EUR"],
    source: "LinkedIn",
    status: "scored",
    score: 64,
    family: "CRM & Email",
    h: 106,
    jd: "Fluxwave is a fully remote e-commerce enablement platform serving DTC brands across Europe. You'll own email marketing execution — campaigns, flows and list hygiene — for a product used by 3,000+ merchants.",
    jdFull:
      "Fluxwave provides e-commerce automation tools used by over 3,000 DTC merchants across Europe. We're a 30-person, fully remote company with contributors spread across a dozen countries.\n\nThe Role\nAs Email Marketing Specialist you'll own email marketing execution: campaign builds, automated flows and deliverability/list hygiene for our own marketing (not client accounts).\n\nWhat You'll Do\n- Build and send weekly campaign emails to our merchant subscriber base\n- Maintain and optimize automated flows (onboarding, re-engagement, upsell)\n- Monitor deliverability metrics and manage list hygiene\n- A/B test subject lines, send times and content formats\n- Report open/click/conversion metrics monthly\n\nRequirements\n- Hands-on experience with an ESP (Klaviyo, Mailchimp or similar)\n- Understanding of deliverability fundamentals (SPF/DKIM, list hygiene)\n- Comfortable running structured A/B tests on email content\n\nWhat We Offer\n- Fully remote, flexible hours across time zones\n- Ownership of a channel with a large, engaged subscriber base\n- Small team, direct access to the head of marketing",
    req: [
      "Hands-on ESP experience (Klaviyo, Mailchimp or similar)",
      "Understanding of email deliverability fundamentals (SPF/DKIM, list hygiene)",
      "Comfortable running structured A/B tests on subject lines and content",
      "Basic HTML/CSS for email template edits a plus",
      "Clear reporting habits on open/click/conversion metrics",
    ],
    pros: [
      "Ownership diretto di un canale con base iscritti ampia e attiva",
      "Full remote flessibile, accesso diretto all'head of marketing",
    ],
    cons: [
      "Team piccolo, poco supporto su design/copy oltre al ruolo stesso",
      "Salario nella fascia medio-bassa per il ruolo",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2-3 years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nBuon fit sulle competenze email/ESP richieste, esperienza pregressa comparabile su flow automation e A/B test. Nessun vincolo geografico, ruolo full remote.",
    scoreNotes:
      "Punteggio nella media: competenze email marketing solide, salario leggermente sotto il target atteso per il livello di esperienza.",
  },
  {
    title: "Influencer Marketing Manager",
    company: "Lexio AI",
    city: "munich",
    remote: "hybrid",
    sal: [48000, 60000, "EUR"],
    source: "LinkedIn",
    status: "scored",
    score: 66,
    family: "Brand",
    h: 122,
    jd: "Lexio AI is a Munich-based AI writing assistant startup building awareness through creator partnerships. You'll build and manage a network of micro and mid-tier influencers across DACH, negotiating deals and tracking campaign ROI.",
    jdFull:
      "Lexio AI builds an AI writing assistant for professionals, with a growing consumer user base across DACH. We're a 45-person startup based in Munich, investing heavily in creator-led growth.\n\nThe Role\nAs Influencer Marketing Manager you'll build and manage a network of micro and mid-tier creators (10k-200k followers) across DACH, negotiating partnerships and tracking their contribution to signups.\n\nWhat You'll Do\n- Source, vet and negotiate deals with micro/mid-tier creators across DACH\n- Manage a roster of 30-50 active creator partnerships\n- Track campaign performance: reach, engagement, signup attribution via promo codes\n- Coordinate content briefs and approval workflows with creators\n- Report ROI monthly against a dedicated creator marketing budget\n\nRequirements\n- Experience managing influencer/creator partnerships end-to-end\n- Comfortable negotiating rates and contracts with creators or their agents\n- Experience tracking campaign performance via promo codes or affiliate links\n- German language skills strongly preferred for DACH creator outreach\n\nWhat We Offer\n- Hybrid role, two days/week in our Munich office\n- Dedicated creator marketing budget\n- Fast-moving startup environment with visible campaign results",
    req: [
      "Experience managing influencer/creator partnerships end-to-end",
      "Comfortable negotiating rates and contracts with creators or agents",
      "Experience tracking ROI via promo codes or affiliate links",
      "German language skills strongly preferred for DACH outreach",
      "Organized approach to managing 30+ concurrent partnerships",
    ],
    pros: [
      "Budget creator dedicato con autonomia di negoziazione",
      "Ambiente startup dinamico con risultati campagna visibili",
    ],
    cons: [
      "Tedesco fortemente preferito per l'outreach DACH, non confermato nel profilo",
      "Gestione di un roster ampio (30-50 creator) richiede forte organizzazione",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2-4 years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: German + English\n\nEsperienza di influencer marketing trasferibile, ma il mercato DACH richiede tedesco fluente non confermato nel background del candidato.\nNOTE_MISMATCH: [LANGUAGE] Tedesco fortemente preferito per l'outreach con creator DACH, il candidato dichiara solo inglese.",
    scoreNotes:
      "Punteggio nella media: esperienza di influencer marketing solida ma il gap linguistico sul tedesco pesa su un mercato DACH-centrico.",
  },
  {
    title: "Community Manager",
    company: "Kernelworks",
    remote: "full_remote",
    sal: [40000, 55000, "USD"],
    source: "Hacker News",
    status: "scored",
    score: 59,
    family: "Content",
    h: 132,
    jd: "Kernelworks is a fully remote open-source infrastructure company with a global contributor community. You'll manage the Discord and GitHub Discussions community, run contributor programs and support developer relations events.",
    jdFull:
      "Kernelworks builds open-source infrastructure tooling used by thousands of developers, with a global, largely volunteer contributor base. We're a fully remote, 20-person company with a strong emphasis on community-led growth.\n\nThe Role\nAs Community Manager you'll own our Discord (15k members) and GitHub Discussions, run contributor recognition programs, and support developer relations events like meetups and conference presence.\n\nWhat You'll Do\n- Moderate and grow engagement in our Discord and GitHub Discussions\n- Run a monthly contributor spotlight and recognition program\n- Support DevRel with meetup coordination and conference booth staffing\n- Track community health metrics (active members, response time, sentiment)\n- Escalate technical questions to the right engineering owner\n\nRequirements\n- Experience managing a technical/developer community (Discord, GitHub, forums)\n- Comfortable in an open-source or developer-tools context\n- Async-first communication skills across time zones\n\nWhat We Offer\n- Fully remote, distributed team across time zones\n- Direct impact on a community central to the product's growth\n- Flexible hours, async-first culture",
    req: [
      "Experience managing a technical/developer community (Discord, GitHub, forums)",
      "Comfortable in an open-source or developer-tools context",
      "Async-first communication across time zones",
      "Basic technical literacy to route/escalate developer questions",
      "Experience running recognition or ambassador programs a plus",
    ],
    pros: [
      "Community già consolidata (15k membri Discord), non da costruire da zero",
      "Cultura full remote e async-first",
    ],
    cons: [
      "Contesto open-source/developer richiede familiarità tecnica non scontata",
      "Compenso in USD, possibile disallineamento fiscale/valutario per il candidato",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2-4 years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo community su prodotto open-source/developer-facing, dominio meno familiare rispetto al background marketing generalista del candidato.\nNOTE_MISMATCH: [DOMAIN] Nessuna esperienza pregressa in community open-source o developer-facing, principalmente community consumer/brand.",
    scoreNotes:
      "Punteggio nella media-bassa: competenze di community management trasferibili ma il dominio open-source/developer è nuovo e centrale per il ruolo.",
  },
  {
    title: "Field Marketing Manager, Italy",
    company: "Databridge",
    city: "milano",
    remote: "hybrid",
    sal: [46000, 58000, "EUR"],
    source: "LinkedIn",
    status: "scored",
    score: 71,
    family: "Brand",
    h: 142,
    jd: "Databridge is a data infrastructure vendor expanding its Italian enterprise sales motion. You'll plan and run field marketing programs — regional events, partner co-marketing and account-based campaigns — supporting the Italian sales team's pipeline goals.",
    jdFull:
      "Databridge provides data integration infrastructure to enterprise clients across Southern Europe, with a growing Italian sales team based in Milan. We're a 300-person company with a dedicated field marketing function per region.\n\nThe Role\nAs Field Marketing Manager, Italy you'll run the local events and partner co-marketing calendar, supporting the Italian sales team's pipeline targets with account-based programs for named enterprise accounts.\n\nWhat You'll Do\n- Plan and execute regional events (roundtables, dinners, partner co-hosted sessions)\n- Run ABM campaigns for a list of ~50 named enterprise accounts in Italy\n- Manage co-marketing relationships with system integrator partners\n- Track event and campaign-sourced pipeline with the Italian sales team\n- Localize global campaigns for the Italian market\n\nRequirements\n- Experience in field marketing or ABM for enterprise B2B accounts\n- Comfortable managing partner co-marketing relationships\n- Native Italian with professional English for global team coordination\n- Experience tracking pipeline attribution with a sales team\n\nWhat We Offer\n- Hybrid role, two days/week in our Milan office\n- Direct collaboration with the Italian sales leadership\n- Clear pipeline targets with quarterly bonus",
    req: [
      "Field marketing or ABM experience for enterprise B2B accounts",
      "Comfortable managing partner/system integrator co-marketing relationships",
      "Native Italian, professional English for global coordination",
      "Experience tracking event/campaign-sourced pipeline attribution",
      "Regional event planning and logistics experience",
    ],
    pros: [
      "Collaborazione diretta con la leadership sales italiana",
      "Target di pipeline chiari con bonus trimestrale",
      "Ruolo ABM su account enterprise nominati, alta visibilità",
    ],
    cons: [
      "Fortemente dipendente dal ciclo vendite enterprise, tempi lunghi",
      "Gestione partner esterni aggiunge complessità di coordinamento",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3-5 years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Italian + English\n\nBuon allineamento su field marketing enterprise e madrelingua italiana richiesta. Esperienza ABM su account nominati presente nel background del candidato.",
    scoreNotes:
      "Punteggio buono: profilo field marketing enterprise coerente, lingua italiana nativa soddisfatta pienamente e nessuna barriera geografica.",
  },
  {
    title: "Junior Marketing Specialist",
    company: "AgencyOne",
    city: "roma",
    remote: "onsite",
    sal: [24000, 30000, "EUR"],
    source: "Indeed",
    status: "checked",
    family: "Growth",
    h: 152,
    jd: "AgencyOne is a Rome-based full-service marketing agency serving local SME clients across retail and hospitality. You'll support senior marketers on social, email and light content production, a hands-on entry point into agency marketing.",
    jdFull:
      "AgencyOne is a 12-person full-service marketing agency in Rome, working with local SME clients in retail, hospitality and professional services. We're growing our junior team to support increasing client volume.\n\nThe Role\nAs Junior Marketing Specialist you'll support senior account managers across social media scheduling, email campaign setup and light content production for a rotating portfolio of clients.\n\nWhat You'll Do\n- Schedule and publish social content across client accounts\n- Set up and send email campaigns using Mailchimp\n- Support senior marketers with basic reporting decks\n- Assist with light copywriting and content editing tasks\n\nRequirements\n- Some prior marketing internship or coursework experience\n- Basic familiarity with social scheduling tools and Mailchimp\n- Italian mother tongue, comfortable in a fast-paced agency environment\n- Willingness to work onsite full-time in our Rome office\n\nWhat We Offer\n- Onsite role in central Rome, full training provided\n- Exposure to a wide variety of clients and marketing disciplines\n- Clear entry point into a marketing career",
    req: [
      "Prior marketing internship or relevant coursework",
      "Basic familiarity with social scheduling tools and Mailchimp",
      "Italian mother tongue",
      "Comfortable in a fast-paced, client-facing agency environment",
      "Full-time onsite availability in Rome",
    ],
    notes:
      "SENIORITY_JD: junior\nEXPERIENCE_REQUIRED: 0-1 years\nEXPERIENCE_TYPE: preferred\nDEGREE: preferred\nLANGUAGE_REQUIRED: Italian\n\nRuolo entry-level onsite, adatto come punto di ingresso ma con retribuzione junior e presenza fisica a tempo pieno che riduce la flessibilità rispetto alle preferenze abituali del candidato.\nNOTE_MISMATCH: [SALARY] Fascia 24-30k EUR nella parte bassa del mercato per ruoli marketing entry-level.",
    addr: "Via del Corso 210, 00186 Roma",
  },
  {
    title: "Head of Marketing",
    company: "Portico",
    city: "lisbon",
    remote: "full_remote",
    sal: [70000, 90000, "EUR"],
    source: "Wellfound",
    status: "checked",
    family: "Growth",
    h: 158,
    jd: "Portico is a fully remote proptech startup helping landlords manage rental portfolios across Southern Europe. You'll build and lead the marketing function from the ground up, reporting directly to the CEO.",
    jdFull:
      "Portico helps independent landlords and small property managers run rental portfolios across Portugal, Spain and Italy, with 15,000+ units under management. We're a 40-person, fully remote startup at Series A.\n\nThe Role\nAs Head of Marketing you'll build the marketing function from the ground up: brand, content, paid acquisition and lifecycle, hiring a small team as you scale. You'll report directly to the CEO and sit on the leadership team.\n\nWhat You'll Do\n- Define marketing strategy and own the annual budget\n- Build and lead a team of 2-4 marketers over the first year\n- Own brand positioning across three markets (PT, ES, IT)\n- Set and report on pipeline/growth KPIs to the leadership team and board\n- Represent marketing in board meetings and fundraising narrative\n\nWhat We're Looking For\n- Experience building or scaling a marketing function from an early stage\n- Comfortable operating across multiple European markets and languages\n- Strong strategic and hands-on execution balance\n\nWhat We Offer\n- Fully remote, flexible across the EU\n- Leadership team seat with board exposure\n- Meaningful equity package",
    req: [
      "Experience building or scaling a marketing function from an early stage",
      "Comfortable operating across multiple European markets/languages",
      "Strong balance of strategic thinking and hands-on execution",
      "Experience managing and growing a small team",
      "Board/leadership-level reporting experience a plus",
    ],
    notes:
      "SENIORITY_JD: lead\nEXPERIENCE_REQUIRED: 7+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo di leadership con ownership completa della funzione marketing, seniority superiore rispetto al livello attuale del candidato che non ha ancora gestito un team diretto.\nNOTE_MISMATCH: [SENIORITY] Ruolo Head richiede esperienza di team building e board reporting non ancora presente nel percorso del candidato.",
  },
  {
    title: "PR & Communications Manager",
    company: "Nordwind",
    city: "stockholm",
    remote: "hybrid",
    sal: [50000, 62000, "EUR"],
    source: "LinkedIn",
    status: "checked",
    family: "Brand",
    h: 166,
    jd: "Nordwind is a Stockholm-based cleantech company building battery recycling infrastructure across the Nordics. You'll own external communications and media relations, positioning the company as a category leader in sustainable industry.",
    jdFull:
      "Nordwind builds battery recycling infrastructure for the growing EV market across the Nordics, backed by climate-focused investors. We're a 55-person company based in Stockholm, increasingly visible in industry and mainstream press.\n\nThe Role\nAs PR & Communications Manager you'll own media relations and external communications, working closely with the CEO on thought leadership and positioning Nordwind as a category leader in sustainable industry.\n\nWhat You'll Do\n- Build and manage relationships with Nordic and EU trade/business press\n- Draft press releases, bylines and executive talking points\n- Coordinate media training and speaking opportunities for the CEO\n- Monitor and report media coverage and sentiment\n- Support crisis communications planning as needed\n\nRequirements\n- Experience in B2B or corporate communications, ideally cleantech/industrial\n- Established relationships with Nordic or EU business press a plus\n- Strong writing skills in English; Swedish a plus\n- Comfortable working closely with C-level executives\n\nWhat We Offer\n- Hybrid role, two days/week in our Stockholm office\n- High-visibility role in a fast-growing climate-tech category\n- Direct access to the CEO and leadership team",
    req: [
      "Experience in B2B or corporate communications, ideally cleantech/industrial",
      "Established relationships with Nordic or EU business press a plus",
      "Strong English writing skills, Swedish a plus",
      "Comfortable working closely with C-level executives",
      "Crisis communications experience a plus",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 4-6 years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English + Swedish (plus)\n\nRuolo di comunicazione corporate in settore cleantech, dominio nuovo per il candidato ma competenze di media relations trasferibili. Relazioni pregresse con stampa nordica non presenti.\nNOTE_MISMATCH: [GEO] Nessuna relazione pregressa con testate nordiche/svedesi, rete media del candidato concentrata altrove.",
    addr: "Sveavägen 44, 111 34 Stockholm",
  },
  {
    title: "Marketing Operations Manager",
    company: "Ostrava Tech",
    city: "prague",
    remote: "hybrid",
    sal: [40000, 52000, "EUR"],
    source: "Company site",
    status: "new",
    family: "CRM & Email",
    h: 176,
    jdFull:
      "Ostrava Tech provides workflow software for manufacturing and logistics companies across Central Europe, with a growing marketing team based in Prague. We're a 110-person company scaling our go-to-market operations.\n\nThe Role\nAs Marketing Operations Manager you'll own the systems and processes behind marketing: CRM hygiene, campaign operations, martech stack management and reporting infrastructure.\n\nWhat You'll Do\n- Own and maintain the marketing tech stack (HubSpot, data warehouse integrations)\n- Build and maintain reporting dashboards for the marketing leadership team\n- Manage lead routing, scoring and CRM data hygiene in partnership with sales ops\n- Support campaign operations: list builds, UTM governance, QA of automated sends\n- Document processes and train the marketing team on tooling best practices\n\nRequirements\n- Experience owning a marketing tech stack (HubSpot, Marketo or similar)\n- Comfortable with SQL or a BI tool for reporting\n- Process-oriented, detail-driven approach to CRM data hygiene\n- Experience with lead routing/scoring models\n\nWhat We Offer\n- Hybrid role, two days/week in our Prague office\n- Central role supporting the entire marketing team's effectiveness\n- Structured onboarding into a growing martech stack",
  },
  {
    title: "Ecommerce Marketing Manager",
    company: "Old Mill Software",
    city: "madrid",
    remote: "hybrid",
    sal: [38000, 48000, "EUR"],
    source: "InfoJobs",
    status: "new",
    family: "Growth",
    h: 186,
    jdFull:
      "Old Mill Software builds e-commerce platform plugins for mid-market online retailers across Spain and Portugal, with a direct-to-merchant marketing motion. We're a 65-person company based in Madrid, growing our own e-commerce presence for merchant acquisition.\n\nThe Role\nAs Ecommerce Marketing Manager you'll run the marketing that acquires merchants for our own platform: paid acquisition, conversion rate optimization on our marketing site, and lifecycle campaigns for trial merchants.\n\nWhat You'll Do\n- Manage paid acquisition campaigns (Google, Meta) targeting SME online retailers\n- Run CRO experiments on our marketing site and signup flow\n- Own lifecycle email campaigns for trial-to-paid merchant conversion\n- Analyze merchant acquisition cost and lifetime value by channel\n- Coordinate with product on plugin marketplace visibility (Shopify, WooCommerce)\n\nRequirements\n- Experience in e-commerce or marketplace marketing\n- Hands-on paid acquisition experience (Google Ads, Meta Ads)\n- Comfortable with CRO experimentation and basic A/B testing\n- Spanish or Portuguese language skills a plus\n\nWhat We Offer\n- Hybrid role, two days/week in our Madrid office\n- Direct exposure to e-commerce merchant acquisition economics\n- Growing marketplace presence (Shopify App Store, WooCommerce)",
  },
  {
    title: "Video Content Creator",
    company: "Testardo",
    city: "torino",
    remote: "hybrid",
    sal: [30000, 40000, "EUR"],
    source: "Indeed",
    status: "new",
    family: "Content",
    h: 192,
    jdFull:
      "Testardo is a Turin-based DTC food brand building a loyal following through short-form video content. We're a 18-person team with an in-house creative studio, shipping content daily across TikTok, Instagram and YouTube.\n\nThe Role\nAs Video Content Creator you'll shoot, edit and publish short-form video content showcasing our products, behind-the-scenes production, and founder-led storytelling.\n\nWhat You'll Do\n- Shoot and edit short-form video content for TikTok, Reels and YouTube Shorts\n- Collaborate with the founder on on-camera content and storytelling\n- Maintain a daily-to-weekly publishing cadence across platforms\n- Monitor performance and iterate on formats that drive engagement\n- Support occasional photo content for the e-commerce site\n\nRequirements\n- Portfolio of short-form video content (personal or professional)\n- Hands-on video editing skills (CapCut, Premiere or similar)\n- Comfortable being on-camera or directing on-camera talent\n- Based in or willing to relocate near Turin for in-studio shoots\n\nWhat We Offer\n- Hybrid role, in-studio shoots plus remote editing days\n- In-house creative studio with real production equipment\n- Direct creative collaboration with the founder",
  },
  {
    title: "Door-to-door Sales Promoter",
    company: "PromoPlus",
    city: "napoli_x",
    remote: "onsite",
    sal: [18000, 24000, "EUR"],
    source: "Indeed",
    status: "excluded",
    score: 18,
    family: "Sales",
    h: 202,
    jd: "PromoPlus is a field sales agency running door-to-door promotional campaigns for energy and telecom providers across Southern Italy. You'll canvass residential areas, pitch offers directly to homeowners and close on the spot.",
    jdFull:
      "PromoPlus runs door-to-door promotional sales campaigns on behalf of energy and telecom providers across Campania. We're a 40-person field sales agency with a strictly commission-driven structure.\n\nThe Role\nAs Door-to-door Sales Promoter you'll canvass assigned residential zones, pitch energy and telecom offers directly to homeowners, and close contracts on the spot.\n\nWhat You'll Do\n- Canvass assigned residential areas door-to-door, 6 days/week\n- Pitch and close energy/telecom contracts using provided scripts\n- Meet weekly contract targets to unlock commission\n- Report daily activity to your team lead\n\nRequirements\n- No prior experience required, full training provided\n- Comfortable with high-volume, in-person cold pitching\n- Own transportation for reaching assigned zones\n- Fully commission-based compensation structure\n\nWhat We Offer\n- Uncapped commission for top performers\n- Daily training and team lead support\n- Immediate start",
    cons: [
      "Compenso quasi interamente a commissione, nessuna base fissa competitiva",
      "Nessuna affinità con il percorso professionale marketing del candidato",
    ],
    notes:
      "EXCLUDED: [DOMAIN] Ruolo di vendita porta a porta puramente commissionale, senza affinità con il percorso marketing/digital del candidato e fuori target di ricerca.",
    scoreNotes:
      "Punteggio molto basso: ruolo di vendita diretta a compenso quasi interamente commissionale, nessuna sovrapposizione con competenze marketing digitali del candidato.",
  },
  {
    title: "Telemarketing Operator",
    company: "CallItalia",
    city: "roma",
    remote: "onsite",
    sal: [20000, 25000, "EUR"],
    source: "Indeed",
    status: "excluded",
    score: 24,
    family: "Sales",
    h: 212,
    jd: "CallItalia is a Rome-based outbound call center running telemarketing campaigns for insurance and utility clients. You'll make outbound calls from provided lead lists, pitching offers and scheduling follow-ups for account managers.",
    jdFull:
      "CallItalia operates outbound call center campaigns on behalf of insurance and utility clients across Italy. We're a 200-seat call center based in Rome, with a fully onsite, shift-based operation.\n\nThe Role\nAs Telemarketing Operator you'll make outbound calls from provided lead lists, following scripts to pitch insurance and utility offers, and schedule qualified follow-ups for account managers.\n\nWhat You'll Do\n- Make 80-100 outbound calls per shift from provided lead lists\n- Follow approved scripts to pitch offers and handle objections\n- Log call outcomes and schedule follow-ups in the internal CRM\n- Meet weekly conversion targets set by the team lead\n\nRequirements\n- No prior experience required, training provided\n- Comfortable with high-volume scripted outbound calling\n- Fully onsite, shift-based availability (including some evenings)\n- Italian mother tongue\n\nWhat We Offer\n- Fixed base salary plus per-conversion bonus\n- Onsite training program\n- Immediate start, shift flexibility within the week",
    cons: [
      "Ruolo completamente operativo, nessuna leva strategica o creativa",
      "Turni fissi onsite con possibili serali",
    ],
    notes:
      "EXCLUDED: [DOMAIN] Ruolo di telemarketing outbound scripted, fuori target rispetto al percorso marketing/digital del candidato e privo di elementi strategici rilevanti per il profilo.",
    scoreNotes:
      "Punteggio molto basso: ruolo operativo di call center con turni fissi onsite, nessuna sovrapposizione con competenze di marketing strategico o digitale.",
  },
  {
    title: "Lifecycle Marketing Manager",
    company: "Cobalt Loop",
    city: "rotterdam",
    remote: "hybrid",
    sal: [46000, 58000, "EUR"],
    source: "LinkedIn",
    status: "new",
    family: "CRM & Email",
    h: 3,
    jdFull:
      "Cobalt Loop is a Rotterdam-based fintech building banking tools for European SMEs, serving more than 60,000 business customers across the Benelux and DACH markets.\n\nThe Role\nWe are hiring a Lifecycle Marketing Manager to own the customer journey after signup: onboarding, activation, retention and win-back, across email, in-app messaging and push notifications.\n\nWhat You'll Do\n- Design and operate lifecycle campaigns in Customer.io\n- Partner with Product and Data teams to define trigger-based flows\n- Own retention KPIs (D30/D90 activation, churn) and report monthly to leadership\n- Run structured A/B tests on subject lines, send cadence and segmentation logic\n- Keep a shared content calendar aligned with the Brand team\n\nWhat We Offer\n- Hybrid setup, three days a week in our Rotterdam office\n- €1,500/year learning budget\n- 28 vacation days\n- Stock options after 12 months\n\nWe are a 90-person team that moves fast and values ownership. If you enjoy data-driven marketing with a real product behind it, we would like to hear from you.",
    addr: "Blaak 28, 3011 TA Rotterdam",
  },
  {
    title: "Performance Marketing Specialist",
    company: "Driftwave",
    city: "warsaw",
    remote: "hybrid",
    sal: [95000, 125000, "PLN"],
    source: "StepStone",
    status: "new",
    family: "Performance Ads",
    h: 8,
    jdFull:
      "Driftwave designs and sells sustainable homeware direct-to-consumer across ten EU markets from our Warsaw hub, shipping from a single European warehouse to keep our carbon footprint low.\n\nThe Role\nWe need a Performance Marketing Specialist to manage day-to-day execution on Meta and Google Ads, working closely with our Head of Growth on budget pacing and creative iteration.\n\nWhat You'll Do\n- Run and optimize Meta, Google Shopping and Pinterest campaigns (~€60k/month combined budget)\n- Build weekly performance reports (ROAS, CAC, blended CPA) for the leadership team\n- Brief the design team on creative refreshes based on fatigue signals\n- Support UTM hygiene and campaign naming conventions across channels\n- Test new placements and audience segments monthly\n\nWhat We Offer\n- Hybrid, two office days per week in central Warsaw\n- Employee discount on the full catalogue\n- Private healthcare package\n- Small, flat team where you will own real budget from day one\n\nWe are looking for someone who is comfortable in the numbers but also cares about the creative side of ecommerce marketing.",
  },
  {
    title: "Content Marketing Lead",
    company: "Fernwood Analytics",
    city: "lyon",
    remote: "full_remote",
    sal: [52000, 66000, "EUR"],
    source: "Welcome to the Jungle",
    status: "new",
    family: "Content",
    h: 15,
    jdFull:
      "Fernwood Analytics builds retail analytics software used by mid-market grocery and apparel chains across France, Spain and Italy to forecast demand and optimize inventory.\n\nThe Role\nAs Content Marketing Lead you will own our editorial strategy end to end: blog, gated reports, and a monthly retail-data newsletter that has become a lead source for the sales team.\n\nWhat You'll Do\n- Plan and execute a quarterly content calendar aligned with product launches\n- Write and commission long-form pieces on retail analytics trends\n- Manage two freelance writers and one designer\n- Own newsletter growth (currently 4,200 subscribers) and open-rate targets\n- Partner with Sales on case studies and one-pagers\n\nWhat We Offer\n- Fully remote within the EU, optional quarterly gathering in Lyon\n- €800/year home-office stipend\n- Flexible hours, async-first culture\n- Direct line to the CMO, no layers of approval\n\nFernwood is a 45-person team, profitable, and growing steadily rather than chasing hypergrowth. We value clear writing over marketing jargon.",
  },
  {
    title: "Sales Development Representative",
    company: "Northgate Commerce",
    city: "budapest",
    remote: "hybrid",
    source: "Indeed",
    status: "new",
    family: "Sales",
    h: 20,
    jdFull:
      "Northgate Commerce runs a B2B marketplace connecting industrial suppliers with manufacturers across Central and Eastern Europe, processing over €40M in annual transaction volume.\n\nThe Role\nWe are hiring a Sales Development Representative to build and qualify our outbound pipeline, working closely with two Account Executives who close the deals you source.\n\nWhat You'll Do\n- Prospect and qualify leads via LinkedIn, cold email and phone outreach\n- Book 15+ qualified discovery calls per month\n- Maintain accurate records in HubSpot CRM\n- Collaborate with Marketing on outbound sequence copy and targeting lists\n- Attend two industry trade fairs per year as a booth support\n\nWhat We Offer\n- Hybrid, three days a week in our Budapest office near Deák Ferenc tér\n- Base + uncapped commission structure\n- Clear promotion path to Account Executive within 12-18 months\n- Sales training budget\n\nWe are looking for someone early in their sales career who is coachable, resilient on the phone, and comfortable with a numbers-driven role.",
  },
  {
    title: "Brand Partnerships Manager",
    company: "Silverlane",
    city: "frankfurt",
    remote: "hybrid",
    sal: [58000, 72000, "EUR"],
    source: "Xing",
    status: "checked",
    family: "Brand",
    h: 28,
    jd: "German enterprise software vendor for manufacturing and logistics workflows. You would own co-marketing partnerships, trade fair presence and industry association relationships across DACH, working closely with Sales on partner-sourced pipeline.",
    jdFull:
      "Silverlane builds workflow automation software for mid-size manufacturing and logistics companies across DACH, with over 300 enterprise customers.\n\nThe Role\nWe are looking for a Brand Partnerships Manager to grow our footprint through co-marketing deals, industry associations and flagship events, reporting to the Head of Marketing.\n\nWhat You'll Do\n- Identify and negotiate co-marketing partnerships with complementary B2B vendors\n- Own our presence at 4-5 major DACH trade fairs per year, including booth strategy\n- Manage relationships with two industry associations and sponsorship renewals\n- Track partnership ROI and report quarterly to leadership\n- Coordinate with Sales on partner-sourced pipeline\n\nWhat We Offer\n- Hybrid, three office days per week in Frankfurt\n- Company car allowance for event travel\n- 30 vacation days\n- Annual team offsite\n\nRequirements\n- 4+ years in B2B partnerships, brand or field marketing\n- Fluent German and English\n- Comfortable negotiating commercial terms with external partners\n- Experience running trade fair logistics is a strong plus\n\nSilverlane is a 220-person scale-up, profitable since 2023, with a low-drama engineering-led culture.",
    req: [
      "4+ years in B2B partnerships, brand or field marketing",
      "Fluent German (C1+) and English",
      "Track record negotiating commercial partnership terms",
      "Experience managing trade fair logistics and booth strategy",
      "Comfortable presenting partnership ROI to leadership",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 4+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: German C1 + English\n\nRuolo di Brand Partnerships in un vendor enterprise DACH consolidato, buona coerenza con esperienza pregressa in field/brand marketing B2B del candidato. Il tedesco fluente richiesto come mandatory è il vincolo principale, da verificare in colloquio.\nNOTE_MISMATCH: [LANGUAGE] Tedesco C1 richiesto come requisito bloccante, il candidato dichiara livello B2 non ancora certificato.",
  },
  {
    title: "Growth Marketing Specialist",
    company: "Meridian Cloud",
    city: "krakow",
    remote: "hybrid",
    sal: [90000, 115000, "PLN"],
    source: "LinkedIn",
    status: "checked",
    family: "Growth",
    h: 34,
    jd: "Krakow-based DevOps monitoring SaaS looking for a Growth Marketing Specialist to run acquisition experiments across paid, SEO and product-led loops on the free-tier funnel, with a weekly experiment cadence and a small growth pod reporting into the Head of Growth.",
    jdFull:
      "Meridian Cloud builds infrastructure monitoring software for DevOps teams, used by over 1,800 companies worldwide, with an engineering hub in Krakow and a small marketing team split between Krakow and remote.\n\nThe Role\nWe're hiring a Growth Marketing Specialist to run acquisition experiments across paid, content-led SEO and product-led growth loops for our free-tier signup funnel.\n\nWhat You'll Do\n- Run a weekly experiment cadence across landing pages, onboarding emails and paid channels\n- Own the free-to-paid conversion funnel dashboard in Amplitude\n- Collaborate with Product on in-app upgrade prompts\n- Manage a monthly budget of ~$15k across Google and LinkedIn Ads\n- Present experiment results at the bi-weekly growth review\n\nWhat We Offer\n- Hybrid, two days a week in our Krakow office at Rynek Główny\n- Stock options\n- Conference budget (one international conference per year)\n- Small growth pod with direct access to Product and Engineering\n\nRequirements\n- 2-4 years in growth or product marketing, ideally B2B SaaS\n- Comfortable with SQL for basic funnel analysis\n- Experience running structured A/B tests\n- English fluent, Polish a plus but not required",
    req: [
      "2-4 years in growth or product marketing, ideally B2B SaaS",
      "Comfortable with SQL for basic funnel analysis",
      "Experience running structured A/B tests",
      "English fluent, Polish a plus but not required",
      "Familiarity with Amplitude or similar product analytics",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2-4 anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Inglese fluente\n\nRuolo growth in una SaaS DevOps B2B, allineato al profilo del candidato su esperimenti e funnel free-to-paid. Il requisito SQL è basilare e coperto dall'esperienza pregressa su dashboard di conversione.",
    addr: "Rynek Główny 12, 31-042 Kraków",
  },
  {
    title: "Product Marketing Lead",
    company: "Hearthstone Labs",
    city: "helsinki",
    remote: "full_remote",
    sal: [64000, 82000, "EUR"],
    source: "Otta",
    status: "checked",
    family: "Product Marketing",
    h: 40,
    jd: "Nordics-based smart-building SaaS scaling into EU markets, hiring a Product Marketing Lead to own positioning, launch plans and sales enablement for two new product lines, managing one associate and reporting to the VP of Marketing.",
    jdFull:
      "Hearthstone Labs builds smart-building software for commercial real estate operators, helping facility teams cut energy costs through predictive maintenance and IoT sensors.\n\nThe Role\nWe are hiring a Product Marketing Lead to own positioning, launches and sales enablement as we expand from Nordics-only to a wider EU rollout.\n\nWhat You'll Do\n- Define positioning and messaging for two new product lines launching this year\n- Build launch plans in partnership with Product and Sales\n- Create sales enablement material: battlecards, ROI calculators, case studies\n- Run win/loss interviews and feed insights back to Product\n- Manage one Product Marketing Associate\n\nWhat We Offer\n- Fully remote, EU timezone required\n- Quarterly team gathering in Helsinki\n- Home office budget of €1,000\n- Direct reporting line to the VP of Marketing\n\nRequirements\n- 5+ years in product marketing, B2B SaaS preferred\n- Experience owning full product launches end to end\n- Comfortable running customer interviews and synthesizing findings\n- Line management experience is a plus but not required\n- English fluent",
    req: [
      "5+ years in product marketing, B2B SaaS preferred",
      "Experience owning full product launches end to end",
      "Comfortable running customer win/loss interviews",
      "Line management experience is a plus but not required",
      "English fluent",
    ],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 5+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Inglese fluente\n\nRuolo di Product Marketing Lead con gestione di un report diretto, leggermente sopra il livello di esperienza attuale del candidato ma coerente sulla parte di positioning e sales enablement già coperta in ruoli precedenti.\nNOTE_MISMATCH: [SENIORITY] Richiesta gestione diretta di una persona, il candidato non ha ancora esperienza di people management.",
  },
  {
    title: "Junior CRM Executive",
    company: "Trailmix Media",
    city: "cologne",
    remote: "onsite",
    sal: [30000, 36000, "EUR"],
    source: "StepStone",
    status: "checked",
    family: "CRM & Email",
    h: 46,
    jd: "German consumer-tech media publisher hiring a Junior CRM Executive to support newsletter lifecycle campaigns in Klaviyo — welcome flows, re-engagement, list hygiene — under the mentorship of a senior CRM Manager, fully onsite in Cologne.",
    jdFull:
      "Trailmix Media publishes three newsletters and two podcasts covering consumer tech, reaching a combined audience of 280,000 subscribers across Germany and Austria.\n\nThe Role\nWe're hiring a Junior CRM Executive to support our subscriber lifecycle: welcome sequences, re-engagement campaigns and list hygiene, working alongside our CRM Manager.\n\nWhat You'll Do\n- Build and QA email campaigns in Klaviyo\n- Maintain subscriber segments and suppression lists\n- Support A/B tests on subject lines and send times\n- Track weekly open/click metrics and flag anomalies\n- Assist with newsletter sponsorship deliverables\n\nWhat We Offer\n- Onsite role, our Cologne studio near Hohenzollernring\n- Mentorship from a senior CRM Manager\n- Free access to all internal newsletters and events\n- Structured 6-month ramp-up plan\n\nRequirements\n- 0-1 years of experience, internship counts\n- Basic familiarity with any ESP (Klaviyo, Mailchimp, or similar)\n- Detail-oriented, comfortable with repetitive QA tasks\n- German and English, both at working proficiency\n- Interest in media/publishing a plus",
    req: [
      "0-1 years of experience, internship counts",
      "Basic familiarity with any ESP (Klaviyo, Mailchimp, or similar)",
      "Detail-oriented, comfortable with repetitive QA tasks",
      "German and English, both at working proficiency",
      "Interest in media/publishing a plus",
    ],
    notes:
      "SENIORITY_JD: junior\nEXPERIENCE_REQUIRED: 0-1 anni\nEXPERIENCE_TYPE: preferred\nDEGREE: not required\nLANGUAGE_REQUIRED: Tedesco + Inglese\n\nRuolo junior con ramp-up strutturato, buon punto di ingresso ma full onsite e con requisito tedesco che il candidato non soddisfa a livello lavorativo.\nNOTE_MISMATCH: [LANGUAGE] Tedesco richiesto a livello lavorativo, il candidato non lo parla.",
    addr: "Hohenzollernring 72, 50672 Köln",
  },
  {
    title: "SEO Content Manager",
    company: "Anchorpoint",
    city: "oslo",
    remote: "full_remote",
    sal: [520000, 620000, "NOK"],
    source: "LinkedIn",
    status: "scored",
    score: 71,
    family: "Content",
    h: 52,
    jd: "Legaltech SaaS with an inbound-led growth motion, hiring an SEO Content Manager to own keyword strategy, technical SEO audits and programmatic landing pages that currently drive 60% of trial signups, managing two freelance writers.",
    jdFull:
      "Anchorpoint builds contract-review software for in-house legal teams, with a strong inbound-led growth motion driven almost entirely by organic search.\n\nThe Role\nWe're hiring an SEO Content Manager to own our organic growth strategy: technical SEO, programmatic landing pages and a content roadmap that currently drives 60% of new trial signups.\n\nWhat You'll Do\n- Own the keyword strategy and content calendar across legaltech topics\n- Run technical SEO audits and work with Engineering on fixes\n- Build and scale programmatic landing pages for long-tail terms\n- Manage two freelance writers with legal-domain knowledge\n- Report monthly on organic traffic, rankings and trial-signup attribution\n\nWhat We Offer\n- Fully remote, EU/UK timezones\n- Quarterly offsite in Oslo\n- Learning budget for SEO tools and courses\n- Direct reporting to the Head of Marketing\n\nRequirements\n- 4+ years in SEO or content marketing, B2B SaaS preferred\n- Proven track record scaling organic traffic\n- Comfortable briefing developers on technical SEO fixes\n- Experience with Ahrefs/Semrush and GA4\n- English fluent, legal-domain interest a plus",
    req: [
      "4+ years in SEO or content marketing, B2B SaaS preferred",
      "Proven track record scaling organic traffic",
      "Comfortable briefing developers on technical SEO fixes",
      "Experience with Ahrefs/Semrush and GA4",
      "English fluent, legal-domain interest a plus",
    ],
    pros: [
      "Full remote EU/UK senza vincoli di visto",
      "Canale organico già maturo, non si parte da zero",
      "Budget dedicato per tool SEO",
    ],
    cons: [
      "Dominio legale nuovo, curva di apprendimento sul linguaggio tecnico",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 4+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Inglese fluente\n\nRuolo SEO in un dominio legaltech nuovo per il candidato ma con processo (audit tecnici, programmatic pages) molto vicino a esperienze precedenti. Full remote EU/UK compatibile.\nNOTE_MISMATCH: [DOMAIN] Settore legaltech mai coperto direttamente, richiede ramp-up sul linguaggio di dominio.",
    scoreNotes:
      "Buon fit di processo su SEO tecnico e content ops, punteggio penalizzato dalla mancanza di esperienza diretta nel dominio legale.",
  },
  {
    title: "Growth Product Marketer",
    company: "Vantage Fields",
    city: "valencia",
    remote: "hybrid",
    sal: [42000, 54000, "EUR"],
    source: "InfoJobs",
    status: "scored",
    score: 66,
    family: "Product Marketing",
    h: 58,
    jd: "Spanish agtech SaaS hiring a Growth Product Marketer to bridge Product and Growth — in-app messaging, feature announcements, upgrade-prompt experiments and quarterly customer interviews on feature adoption — hybrid in Valencia.",
    jdFull:
      "Vantage Fields builds farm-management software used by mid-size agricultural operations across Spain and Portugal to plan irrigation, track yields and manage compliance.\n\nThe Role\nWe're looking for a Growth Product Marketer who sits between Product and Growth: shaping how new features are positioned and how they drive activation and expansion revenue.\n\nWhat You'll Do\n- Define in-app messaging and feature announcements for new releases\n- Partner with Growth on upgrade-prompt experiments\n- Write release notes and update the public changelog\n- Support pricing-page updates and expansion-revenue campaigns\n- Run quarterly customer interviews on feature adoption\n\nWhat We Offer\n- Hybrid, two days a week in our Valencia office\n- Flexible summer hours (35h weeks July-August)\n- Private health insurance\n- Small team, direct access to the founders\n\nRequirements\n- 2-3 years in product marketing or growth roles\n- Comfortable writing customer-facing release notes\n- Basic experience with in-app messaging tools (Appcues, Pendo, or similar)\n- Spanish and English fluent\n- Interest in agtech or B2B vertical SaaS a plus",
    req: [
      "2-3 years in product marketing or growth roles",
      "Comfortable writing customer-facing release notes",
      "Basic experience with in-app messaging tools (Appcues, Pendo, or similar)",
      "Spanish and English fluent",
      "Interest in agtech or B2B vertical SaaS a plus",
    ],
    pros: [
      "Ruolo ibrido tra product e growth, buona esposizione trasversale",
      "Team piccolo con accesso diretto ai founder",
    ],
    cons: [
      "Spagnolo fluente richiesto, gap linguistico significativo",
      "Settore agtech di nicchia mai esplorato prima",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2-3 anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Spagnolo + Inglese\n\nRuolo ibrido growth/product marketing in un settore agtech di nicchia, requisito spagnolo fluente rappresenta un vincolo importante per il candidato.\nNOTE_MISMATCH: [LANGUAGE] Spagnolo fluente richiesto come mandatory, il candidato ha solo livello base.",
    scoreNotes:
      "Ruolo interessante ma il requisito di spagnolo fluente non è coperto, penalizza sensibilmente il punteggio nonostante il buon fit di processo.",
    addr: "Carrer de Colón 45, 46004 Valencia",
  },
  {
    title: "Paid Media Buyer",
    company: "Kestrel Digital",
    city: "porto",
    remote: "hybrid",
    sal: [34000, 44000, "EUR"],
    source: "Glassdoor",
    status: "scored",
    score: 74,
    family: "Performance Ads",
    h: 64,
    jd: "Porto-based performance marketing agency serving ecommerce and SaaS clients, hiring a Paid Media Buyer to run Meta/Google/TikTok campaigns across a 5-6 client portfolio with budgets from €5k to €80k/month, reporting to an Account Director.",
    jdFull:
      "Kestrel Digital is a performance marketing agency managing paid media for 20+ ecommerce and SaaS clients across Southern Europe, from a boutique studio in Porto.\n\nThe Role\nWe're hiring a Paid Media Buyer to manage a portfolio of 5-6 client accounts across Meta, Google and TikTok Ads, reporting to an Account Director.\n\nWhat You'll Do\n- Build, launch and optimize campaigns across Meta, Google and TikTok\n- Manage monthly budgets ranging from €5k to €80k per client\n- Prepare monthly performance decks for client calls\n- Collaborate with the creative team on ad briefs\n- Stay current on platform updates and pass learnings to the team\n\nWhat We Offer\n- Hybrid, three days a week in our Porto studio\n- Agency-paced environment with varied client exposure\n- Certifications budget (Google, Meta Blueprint)\n- Friday half-days\n\nRequirements\n- 2+ years managing paid social or search campaigns, agency experience a plus\n- Comfortable juggling multiple client accounts simultaneously\n- Strong Excel/Sheets skills for budget tracking\n- English fluent, Portuguese a plus\n- Client-facing communication skills",
    req: [
      "2+ years managing paid social or search campaigns, agency experience a plus",
      "Comfortable juggling multiple client accounts simultaneously",
      "Strong Excel/Sheets skills for budget tracking",
      "English fluent, Portuguese a plus",
      "Client-facing communication skills",
    ],
    pros: [
      "Esposizione a più settori e piattaforme in parallelo",
      "Budget certificazioni incluso",
    ],
    cons: ["Gestione simultanea di 5-6 clienti, ritmo agenzia sostenuto"],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Inglese fluente\n\nRuolo agenzia multi-cliente, buon match sulle competenze di media buying del candidato, ambiente più frenetico rispetto a ruoli in-house precedenti ma coerente con il profilo.",
    scoreNotes:
      "Solido match sulle competenze core di paid media, punteggio buono nonostante l'ambiente agenzia richieda gestione multi-cliente non ancora sperimentata a questo volume.",
  },
  {
    title: "Junior Sales Executive",
    company: "Pathlight",
    city: "tallinn",
    remote: "onsite",
    source: "Indeed",
    status: "scored",
    score: 55,
    family: "Sales",
    h: 70,
    jd: "Baltic edtech company selling an adaptive learning platform to schools, hiring a Junior Sales Executive to support outreach, demo scheduling and proposal follow-up under the Head of Sales, fully onsite in Tallinn.",
    jdFull:
      "Pathlight builds an adaptive learning platform for secondary schools, used in over 400 schools across the Baltics, with a small but growing commercial team based in Tallinn.\n\nThe Role\nWe're hiring a Junior Sales Executive to support our school-district sales cycle: outreach, demo scheduling and proposal follow-up, working directly with our Head of Sales.\n\nWhat You'll Do\n- Reach out to school administrators and district procurement contacts\n- Schedule and occasionally co-run product demos\n- Prepare proposal documents and follow up on pending decisions\n- Maintain the sales pipeline in Pipedrive\n- Attend regional education fairs (2-3 per year)\n\nWhat We Offer\n- Onsite, our Tallinn office in the Ülemiste City tech park\n- Base salary + quarterly bonus tied to team targets\n- Structured onboarding with shadowing\n- Mission-driven team working in education\n\nRequirements\n- 0-2 years of sales or customer-facing experience\n- Comfortable with cold outreach and follow-up cadences\n- Organized, comfortable with CRM data entry\n- English fluent, Estonian or Russian a plus\n- Genuine interest in education sector",
    req: [
      "0-2 years of sales or customer-facing experience",
      "Comfortable with cold outreach and follow-up cadences",
      "Organized, comfortable with CRM data entry",
      "English fluent, Estonian or Russian a plus",
      "Genuine interest in education sector",
    ],
    pros: [
      "Settore mission-driven, education",
      "Onboarding strutturato con affiancamento",
    ],
    cons: [
      "Full onsite a Tallinn, relocation necessaria",
      "Stipendio junior, sotto la fascia media EU",
    ],
    notes:
      "SENIORITY_JD: junior\nEXPERIENCE_REQUIRED: 0-2 anni\nEXPERIENCE_TYPE: preferred\nDEGREE: not required\nLANGUAGE_REQUIRED: Inglese fluente\n\nRuolo junior in edtech, buon punto di ingresso commerciale ma completamente onsite a Tallinn, richiede relocation non confermata dal candidato.\nNOTE_MISMATCH: [GEO] Ruolo onsite a Tallinn, nessuna indicazione di disponibilità a relocation da parte del candidato.",
    scoreNotes:
      "Ruolo junior coerente per un primo ingresso in sales ma il vincolo geografico onsite a Tallinn abbassa sensibilmente il punteggio.",
  },
  {
    title: "Brand Communications Specialist",
    company: "Lumen Retail",
    city: "milano",
    remote: "hybrid",
    sal: [36000, 46000, "EUR"],
    source: "LinkedIn",
    status: "scored",
    score: 63,
    family: "Brand",
    h: 78,
    jd: "Italian DTC beauty brand hiring a Brand Communications Specialist to manage press relationships, influencer seeding and tone of voice across channels, reporting to the Brand Manager, hybrid in Milano.",
    jdFull:
      "Lumen Retail is a DTC beauty and skincare brand with 12 physical stores in Italy and a growing online business, known for a strong community-driven brand voice.\n\nThe Role\nWe're hiring a Brand Communications Specialist to manage our tone of voice across channels, press relationships and influencer seeding, reporting to the Brand Manager.\n\nWhat You'll Do\n- Draft press releases and manage relationships with beauty and lifestyle press\n- Coordinate influencer and micro-creator seeding campaigns\n- Support internal comms for store launches and product drops\n- Maintain brand voice guidelines across social and email\n- Track PR and influencer campaign reach/sentiment\n\nWhat We Offer\n- Hybrid, two days a week at our Milano headquarters in Tortona\n- Generous product allowance\n- Access to store launch events\n- Close-knit brand team of 6 people\n\nRequirements\n- 2-3 years in PR, brand or communications, beauty/fashion a plus\n- Excellent written Italian, good English\n- Experience coordinating influencer campaigns\n- Comfortable with fast-paced, trend-driven environment\n- Portfolio of press placements or campaigns",
    req: [
      "2-3 years in PR, brand or communications, beauty/fashion a plus",
      "Excellent written Italian, good English",
      "Experience coordinating influencer campaigns",
      "Comfortable with fast-paced, trend-driven environment",
      "Portfolio of press placements or campaigns",
    ],
    pros: [
      "Team brand piccolo e coeso",
      "Accesso a eventi ed esperienze del brand",
    ],
    cons: [
      "Settore beauty mai esplorato, portfolio non allineato",
      "Stipendio nella fascia medio-bassa",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2-3 anni\nEXPERIENCE_TYPE: preferred\nDEGREE: not required\nLANGUAGE_REQUIRED: Italiano madrelingua\n\nRuolo brand/PR in un settore beauty distante dal percorso B2B tech del candidato, competenze trasferibili su comunicazione ma dominio molto diverso.\nNOTE_MISMATCH: [DOMAIN] Settore beauty/fashion mai coperto, il candidato ha esperienza quasi esclusivamente B2B tech.",
    scoreNotes:
      "Competenze di comunicazione trasferibili ma il dominio beauty/fashion è distante dal percorso B2B tech del candidato, punteggio nella media.",
    addr: "Via Tortona 27, 20144 Milano",
  },
  {
    title: "Marketing Automation Analyst",
    company: "Bluewire",
    city: "amsterdam",
    remote: "full_remote",
    sal: [48000, 60000, "EUR"],
    source: "Wellfound",
    status: "scored",
    score: 69,
    family: "CRM & Email",
    h: 88,
    jd: "CPaaS company selling SMS/voice/WhatsApp APIs, hiring a Marketing Automation Analyst to own lead-scoring models, nurture sequences and data hygiene across HubSpot, Segment and Salesforce, fully remote in the EU.",
    jdFull:
      "Bluewire is a CPaaS company providing SMS, voice and WhatsApp APIs to enterprise customers, competing in a crowded but growing communications infrastructure market.\n\nThe Role\nWe're hiring a Marketing Automation Analyst to build and maintain the lead-scoring and nurture logic that feeds our sales pipeline, working in HubSpot and Segment.\n\nWhat You'll Do\n- Build and maintain lead-scoring models based on firmographic and behavioral data\n- Design multi-step nurture sequences for different buyer personas\n- Own data hygiene between HubSpot, Segment and Salesforce\n- Report on MQL-to-SQL conversion and flag pipeline leaks\n- Partner with RevOps on attribution reporting\n\nWhat We Offer\n- Fully remote, EU-based\n- €600/year tooling stipend\n- Async-friendly culture with core hours 10-15 CET\n- Small marketing ops team of 3\n\nRequirements\n- 3+ years in marketing operations or automation\n- Hands-on HubSpot admin experience\n- Comfortable with basic SQL for data checks\n- Experience with lead-scoring model design\n- English fluent",
    req: [
      "3+ years in marketing operations or automation",
      "Hands-on HubSpot admin experience",
      "Comfortable with basic SQL for data checks",
      "Experience with lead-scoring model design",
      "English fluent",
    ],
    pros: [
      "Full remote EU, nessun vincolo di visto",
      "Team ops piccolo con impatto diretto sulla pipeline sales",
    ],
    cons: ["Hands-on HubSpot admin non ancora presente nel CV"],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Inglese fluente\n\nRuolo di marketing operations tecnico, buon allineamento su SQL e logica di automazione con l'esperienza pregressa del candidato su CRM e segmentazione.",
    scoreNotes:
      "Buon fit tecnico su automazione e dati, il gap principale è l'esperienza diretta con HubSpot admin più che i concetti di lead scoring.",
  },
  {
    title: "Account Executive, SMB",
    company: "Amberlane",
    city: "berlin",
    remote: "hybrid",
    sal: [50000, 68000, "EUR"],
    source: "LinkedIn",
    status: "scored",
    score: 72,
    family: "Sales",
    h: 96,
    jd: "German people-ops SaaS hiring an Account Executive to own the full SMB sales cycle from inbound lead to close, managing a 40-60 opportunity pipeline with a €25k/month new-ARR quota, hybrid in Berlin.",
    jdFull:
      "Amberlane builds people-ops software (payroll, time-off, performance reviews) for SMBs across Germany and Austria, with over 3,000 customers on the platform.\n\nThe Role\nWe're hiring an Account Executive to own the full sales cycle for our SMB segment (10-100 employees), from qualified inbound lead to close.\n\nWhat You'll Do\n- Run discovery calls and product demos for inbound SMB leads\n- Manage a pipeline of 40-60 active opportunities\n- Negotiate contract terms within defined pricing bands\n- Collaborate with Marketing on lead quality feedback\n- Hit a monthly quota of €25k in new ARR\n\nWhat We Offer\n- Hybrid, three days a week in our Berlin office\n- Uncapped commission on top of a competitive base\n- SPIFFs for early quota achievement\n- Clear path to Mid-Market AE after 12-18 months\n\nRequirements\n- 2+ years of closing experience, SaaS preferred\n- Comfortable with a full-cycle, transactional sales motion\n- Track record hitting or exceeding quota\n- German and English fluent\n- HubSpot or Salesforce experience",
    req: [
      "2+ years of closing experience, SaaS preferred",
      "Comfortable with a full-cycle, transactional sales motion",
      "Track record hitting or exceeding quota",
      "German and English fluent",
      "HubSpot or Salesforce experience",
    ],
    pros: [
      "Percorso di carriera chiaro verso Mid-Market AE",
      "Commissioni uncapped su base competitiva",
    ],
    cons: [
      "Tedesco fluente richiesto, livello attuale intermedio",
      "Quota mensile aggressiva per un mercato SMB",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Tedesco + Inglese\n\nRuolo sales full-cycle SMB, transazionale e ad alto volume, coerente con l'attitudine commerciale del candidato ma il tedesco fluente richiesto resta un vincolo non pienamente coperto.\nNOTE_MISMATCH: [LANGUAGE] Tedesco fluente richiesto per negoziare contratti, il candidato ha livello intermedio.",
    scoreNotes:
      "Motion sales chiaro e quota raggiungibile, ma il gap linguistico sul tedesco pesa sul punteggio complessivo.",
    addr: "Warschauer Strasse 33, 10243 Berlin",
  },
  {
    title: "Growth Hacker",
    company: "Crestfield",
    city: "dublin",
    remote: "full_remote",
    sal: [46000, 58000, "EUR"],
    source: "Hacker News",
    status: "scored",
    score: 58,
    family: "Growth",
    h: 104,
    jd: "Early-stage crypto payments startup (stablecoin payouts for freelancers) hiring a Growth Hacker to build a referral program from scratch and grow organic community channels, working directly with two co-founders in a flat, remote-first structure.",
    jdFull:
      "Crestfield is an early-stage crypto payments startup letting freelancers get paid in stablecoins with automatic FX conversion, currently at 8,000 active users and growing fast.\n\nThe Role\nWe're looking for a scrappy Growth Hacker to own top-of-funnel experiments across referral loops, community channels and organic social, with a lot of autonomy and a tight budget.\n\nWhat You'll Do\n- Design and run a referral program from scratch\n- Grow our Discord and X communities through organic content\n- Run cheap, fast experiments (landing pages, waitlists, viral loops)\n- Track activation and referral metrics in Mixpanel\n- Work directly with the two co-founders, no layers\n\nWhat We Offer\n- Fully remote, async-friendly\n- Token allocation as part of compensation package\n- High autonomy, flat structure\n- Fast-paced, ambiguous environment typical of early-stage startups\n\nRequirements\n- 2+ years in growth roles, startup experience strongly preferred\n- Comfortable operating with minimal process and tight budgets\n- Familiarity with crypto/Web3 culture is a plus\n- Scrappy, experiment-driven mindset\n- English fluent",
    req: [
      "2+ years in growth roles, startup experience strongly preferred",
      "Comfortable operating with minimal process and tight budgets",
      "Familiarity with crypto/Web3 culture is a plus",
      "Scrappy, experiment-driven mindset",
      "English fluent",
    ],
    pros: [
      "Massima autonomia, accesso diretto ai founder",
      "Full remote senza vincoli geografici",
    ],
    cons: [
      "Settore crypto/Web3 mai esplorato",
      "Compenso parzialmente in token, rischio finanziario",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2+ years\nEXPERIENCE_TYPE: preferred\nDEGREE: not required\nLANGUAGE_REQUIRED: Inglese fluente\n\nRuolo growth in un contesto early-stage molto instabile (crypto payments), compensazione parzialmente in token, poca struttura di processo rispetto alle esperienze precedenti del candidato in team più maturi.\nNOTE_MISMATCH: [DOMAIN] Settore crypto/Web3 mai esplorato dal candidato, cultura di prodotto molto diversa dal B2B SaaS tradizionale.",
    scoreNotes:
      "Ruolo interessante per autonomia ma il contesto early-stage crypto e la parte di compenso in token introducono rischio non presente nelle esperienze precedenti del candidato.",
  },
  {
    title: "Field Marketing Specialist, DACH",
    company: "Ironvale",
    city: "munich",
    remote: "onsite",
    sal: [44000, 55000, "EUR"],
    source: "Xing",
    status: "scored",
    score: 61,
    family: "Brand",
    h: 112,
    jd: "Industrial IoT company selling factory-floor sensors, hiring a Field Marketing Specialist to run trade fairs, demo days and regional webinars across DACH with a ~€180k events budget, fully onsite in Munich with frequent regional travel.",
    jdFull:
      "Ironvale builds industrial IoT sensors and monitoring software for factory floors, serving manufacturing customers across Bavaria and Baden-Württemberg.\n\nThe Role\nWe're hiring a Field Marketing Specialist to run regional demand-gen activities: trade fairs, factory-floor demo days and regional webinars for our DACH sales team.\n\nWhat You'll Do\n- Plan and execute 6-8 regional trade fairs and demo days per year\n- Coordinate logistics, booth design and lead capture at events\n- Run quarterly webinars targeting plant managers and operations leads\n- Report event-sourced pipeline to the DACH Sales Director\n- Manage a regional events budget of ~€180k/year\n\nWhat We Offer\n- Onsite role, our Munich office near Landsberger Strasse\n- Company car for regional travel\n- Team of 4 in field marketing\n- Direct exposure to factory customers\n\nRequirements\n- 3+ years in field or event marketing, industrial/B2B preferred\n- Comfortable with frequent regional travel (up to 40%)\n- German fluent, English working proficiency\n- Experience managing event budgets\n- Valid driving license",
    req: [
      "3+ years in field or event marketing, industrial/B2B preferred",
      "Comfortable with frequent regional travel (up to 40%)",
      "German fluent, English working proficiency",
      "Experience managing event budgets",
      "Valid driving license",
    ],
    pros: ["Settore industriale con budget eventi consistente"],
    cons: [
      "Full onsite con travel regionale fino al 40%",
      "Tedesco fluente richiesto, gap linguistico",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Tedesco fluente\n\nRuolo field marketing industriale, full onsite con travel regionale frequente e tedesco fluente richiesto: due vincoli significativi rispetto al profilo del candidato orientato a ruoli più digitali e remoti.\nNOTE_MISMATCH: [STACK] Ruolo fortemente orientato a eventi fisici e logistica, poco allineato al profilo digital-first del candidato.\nNOTE_MISMATCH: [LANGUAGE] Tedesco fluente richiesto, livello del candidato insufficiente.",
    scoreNotes:
      "Il ruolo è distante dal profilo digital-first del candidato sia per il vincolo travel/onsite sia per il tedesco richiesto, punteggio contenuto.",
    addr: "Landsberger Strasse 155, 80687 München",
  },
  {
    title: "Performance Marketing Analyst",
    company: "Willowmere",
    city: "stockholm",
    remote: "hybrid",
    sal: [480000, 580000, "SEK"],
    source: "LinkedIn",
    status: "scored",
    score: 76,
    family: "Performance Ads",
    h: 120,
    jd: "European micro-mobility operator hiring a Performance Marketing Analyst to build cohort-based ROAS models and city-level CAC benchmarks across 30 markets, automating reporting in Looker and advising the Head of Performance on budget allocation.",
    jdFull:
      "Willowmere operates a micro-mobility scooter and e-bike sharing service across 30 European cities, competing on unit economics and rider retention.\n\nThe Role\nWe're hiring a Performance Marketing Analyst to own paid acquisition analytics: cohort-level ROAS, city-level CAC benchmarks and budget allocation recommendations.\n\nWhat You'll Do\n- Build and maintain cohort-based ROAS models by city and channel\n- Recommend budget reallocation across 30 markets based on unit economics\n- Partner with the performance team on channel mix testing\n- Automate weekly reporting dashboards in Looker\n- Support the Head of Performance on quarterly budget planning\n\nWhat We Offer\n- Hybrid, two days a week in our Stockholm HQ\n- Stock options\n- Free rides on the Willowmere fleet\n- Data-driven culture with strong analytics tooling\n\nRequirements\n- 3+ years in performance marketing analytics\n- Strong SQL and spreadsheet modeling skills\n- Experience with Looker or similar BI tools\n- Comfortable presenting budget recommendations to leadership\n- English fluent, Swedish a plus",
    req: [
      "3+ years in performance marketing analytics",
      "Strong SQL and spreadsheet modeling skills",
      "Experience with Looker or similar BI tools",
      "Comfortable presenting budget recommendations to leadership",
      "English fluent, Swedish a plus",
    ],
    pros: [
      "Forte enfasi analitica, coerente con il punto di forza del candidato",
      "Cultura data-driven con tooling BI maturo",
    ],
    cons: [
      "Settore multi-città complesso, curva di apprendimento sulle dinamiche locali",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Inglese fluente\n\nRuolo fortemente analitico su performance marketing, ottimo match con il background SQL e modellazione del candidato, settore multi-città con logiche di unit economics interessanti da imparare.",
    scoreNotes:
      "Match solido sulle competenze analitiche core (SQL, modellazione ROAS), settore nuovo ma il processo di lavoro è molto vicino a esperienze precedenti.",
  },
  {
    title: "Content Marketing Manager, DACH",
    company: "Cinderpath",
    city: "vienna",
    remote: "hybrid",
    sal: [56000, 68000, "EUR"],
    source: "LinkedIn",
    status: "writing",
    score: 74,
    family: "Content",
    h: 130,
    wr: true,
    jd: "Carbon-accounting SaaS riding the CSRD regulatory wave in DACH, hiring a Content Marketing Manager to own thought leadership on emissions reporting, a monthly webinar series and content-sourced pipeline tracking, hybrid in Vienna.",
    jdFull:
      "Cinderpath builds carbon-accounting software helping mid-size companies measure and report Scope 1-3 emissions, with strong momentum in the DACH region ahead of new EU reporting rules.\n\nThe Role\nWe're hiring a Content Marketing Manager to own our DACH content strategy: thought leadership on the CSRD reporting shift, technical guides and a growing webinar series.\n\nWhat You'll Do\n- Own the DACH content calendar across blog, LinkedIn and webinars\n- Translate regulatory complexity (CSRD, ESRS) into accessible content\n- Run a monthly webinar series with sustainability leads as guests\n- Collaborate with Sales on content for the DACH pipeline\n- Track content-sourced pipeline and report monthly\n\nWhat We Offer\n- Hybrid, two days a week in our Vienna office\n- Front-row seat to a fast-growing regulatory-driven market\n- Learning budget for sustainability/ESG certifications\n- Small, senior marketing team\n\nRequirements\n- 4+ years in B2B content marketing\n- German fluent, comfortable writing in both German and English\n- Ability to translate regulatory/technical topics into clear content\n- Experience running or supporting webinar programs\n- Interest in sustainability/ESG a strong plus",
    req: [
      "4+ years in B2B content marketing",
      "German fluent, comfortable writing in both German and English",
      "Ability to translate regulatory/technical topics into clear content",
      "Experience running or supporting webinar programs",
      "Interest in sustainability/ESG a strong plus",
    ],
    pros: [
      "Mercato in forte crescita trainato da nuova normativa CSRD",
      "Team marketing senior e strutturato",
    ],
    cons: ["Scrittura in tedesco richiesta, gap linguistico rilevante"],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 4+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Tedesco fluente + Inglese\n\nRuolo content in un settore regolatorio in forte crescita (CSRD), buon fit di processo con esperienza pregressa in content B2B, il tedesco fluente richiesto per scrivere resta il gap principale.\nNOTE_MISMATCH: [LANGUAGE] Scrittura in tedesco richiesta come requisito primario, il candidato scrive solo in inglese e italiano.",
    scoreNotes:
      "Settore in forte crescita regolatoria e ottimo fit di processo editoriale, penalizzato dal requisito di scrittura in tedesco che il candidato non soddisfa.",
    addr: "Mariahilfer Strasse 88, 1070 Wien",
  },
  {
    title: "CRM Manager, Retention",
    company: "Oakstone Digital",
    city: "copenhagen",
    remote: "full_remote",
    sal: [420000, 500000, "DKK"],
    source: "Otta",
    status: "writing",
    score: 80,
    family: "CRM & Email",
    h: 138,
    wr: true,
    jd: "European specialty-coffee subscription business hiring a CRM Manager to own the full retention lifecycle in Klaviyo — churn-risk flows, win-back campaigns, subscription-pause logic — with a structured A/B testing program, fully remote.",
    jdFull:
      "Oakstone Digital runs a subscription box service for specialty coffee, shipping to 12 European countries with 45,000 active subscribers.\n\nThe Role\nWe're hiring a CRM Manager to own retention: churn-prevention flows, win-back campaigns and subscription-pause logic, working closely with our Data team.\n\nWhat You'll Do\n- Own the full retention lifecycle in Klaviyo: onboarding, churn-risk flows, win-back\n- Design and test subscription-pause vs cancel flows to reduce churn\n- Build cohort-based retention dashboards with the Data team\n- Run a structured A/B testing program across all lifecycle emails\n- Report monthly retention KPIs to the leadership team\n\nWhat We Offer\n- Fully remote, EU timezone\n- Free monthly coffee subscription\n- €700/year learning budget\n- Small, senior marketing team of 5\n\nRequirements\n- 4+ years in CRM/retention marketing, subscription business preferred\n- Deep Klaviyo or Braze expertise\n- Comfortable with cohort analysis and basic SQL\n- Track record reducing churn through lifecycle interventions\n- English fluent",
    req: [
      "4+ years in CRM/retention marketing, subscription business preferred",
      "Deep Klaviyo or Braze expertise",
      "Comfortable with cohort analysis and basic SQL",
      "Track record reducing churn through lifecycle interventions",
      "English fluent",
    ],
    pros: [
      "Match forte su competenze CRM/retention core",
      "Full remote EU, nessun vincolo geografico",
      "Team senior e specializzato",
    ],
    cons: [
      "Settore subscription-box fisico, logistica diversa dal digitale puro",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 4+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Inglese fluente\n\nRuolo CRM/retention molto vicino all'esperienza pregressa del candidato su Braze e segmentazione, settore subscription-box è nuovo ma il processo di lavoro è familiare. Full remote EU senza vincoli.",
    scoreNotes:
      "Ottimo allineamento sulle competenze CRM/retention core, settore diverso dal fintech precedente ma il processo di lifecycle marketing è identico.",
  },
  {
    title: "Product Marketing Manager, EMEA",
    company: "Riverton",
    city: "paris",
    remote: "hybrid",
    sal: [62000, 78000, "EUR"],
    source: "Welcome to the Jungle",
    status: "review",
    score: 78,
    family: "Product Marketing",
    h: 146,
    jd: "Developer-facing payment-reconciliation API platform hiring a Product Marketing Manager, EMEA to own positioning for a technical audience, partnering closely with Developer Relations on launches, content and competitive analysis.",
    jdFull:
      "Riverton builds a developer-facing API platform for payment reconciliation, used by fintech and marketplace engineering teams across Europe.\n\nThe Role\nWe're hiring a Product Marketing Manager, EMEA to own positioning and go-to-market for our developer audience, balancing technical credibility with clear messaging.\n\nWhat You'll Do\n- Own positioning and messaging for our API product line across EMEA\n- Partner with Developer Relations on technical content and demos\n- Build launch plans for new API endpoints and SDKs\n- Create sales enablement content tailored to technical buyers\n- Run competitive analysis against other reconciliation APIs\n\nWhat We Offer\n- Hybrid, two days a week in our Paris office\n- Direct access to Engineering leadership\n- Conference budget for one major dev conference per year\n- Equity package\n\nRequirements\n- 4+ years in product marketing, ideally developer-facing products\n- Comfortable reading API documentation and technical specs\n- Experience partnering with DevRel or technical evangelism teams\n- French and English fluent\n- Track record of successful product launches",
    req: [
      "4+ years in product marketing, ideally developer-facing products",
      "Comfortable reading API documentation and technical specs",
      "Experience partnering with DevRel or technical evangelism teams",
      "French and English fluent",
      "Track record of successful product launches",
    ],
    pros: [
      "Prodotto developer-facing, buon match con background tecnico del candidato",
      "Accesso diretto a leadership engineering",
      "Budget conferenze incluso",
    ],
    cons: ["Francese fluente richiesto, da verificare in colloquio"],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 4+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Francese + Inglese\n\nRuolo product marketing per un pubblico tecnico/developer, buon fit sull'esperienza precedente di positioning B2B SaaS del candidato, il francese fluente resta il vincolo principale da verificare.\nNOTE_MISMATCH: [LANGUAGE] Francese fluente richiesto, livello del candidato non specificato come fluente.",
    scoreNotes:
      "Ottimo match sul lato positioning tecnico e capacità di lavorare con team DevRel, penalizzato dal requisito di francese fluente.",
  },
  {
    title: "Sales Manager, DACH",
    company: "Glasswing",
    city: "frankfurt",
    remote: "hybrid",
    sal: [72000, 90000, "EUR"],
    source: "Xing",
    status: "review",
    score: 82,
    family: "Sales",
    h: 154,
    critic: [5, "NEEDS_WORK"],
    jd: "Cybersecurity monitoring vendor for financial services, hiring a Sales Manager, DACH to lead a team of 4 AEs against a €2.4M new-business ARR quota, with native-level German strongly preferred and quarterly travel across the region.",
    jdFull:
      "Glasswing builds cybersecurity monitoring software for mid-market financial services companies, with a growing DACH sales team of 8 and a strong reference base in German banking.\n\nThe Role\nWe're hiring a Sales Manager, DACH to lead a team of 4 Account Executives, own regional pipeline targets and represent Glasswing at key industry events.\n\nWhat You'll Do\n- Manage and coach a team of 4 Account Executives across Germany, Austria and Switzerland\n- Own the DACH new-business quota (€2.4M ARR annually)\n- Run weekly pipeline reviews and forecast accuracy\n- Represent Glasswing at 3-4 major financial-services security conferences\n- Partner with Marketing on regional demand-gen priorities\n\nWhat We Offer\n- Hybrid, three days a week in our Frankfurt office\n- Competitive base + team-performance bonus\n- Company car allowance\n- Direct reporting to the VP of Sales, EMEA\n\nRequirements\n- 6+ years in B2B SaaS sales, 2+ years managing a sales team\n- Fluent German and English, native-level German strongly preferred\n- Track record owning a 7-figure ARR quota\n- Experience selling into financial services or regulated industries\n- Comfortable with quarterly travel across DACH",
    req: [
      "6+ years in B2B SaaS sales, 2+ years managing a sales team",
      "Fluent German and English, native-level German strongly preferred",
      "Track record owning a 7-figure ARR quota",
      "Experience selling into financial services or regulated industries",
      "Comfortable with quarterly travel across DACH",
    ],
    pros: [
      "Quota importante con bonus di team",
      "Settore in crescita, security per financial services",
    ],
    cons: [
      "Esperienza di management team non presente nel CV",
      "Tedesco quasi madrelingua richiesto",
    ],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 6+ years, incl. 2+ management\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Tedesco madrelingua preferito\n\nRuolo di people management sales in un settore regolamentato (financial services security), quota a 7 cifre e tedesco quasi madrelingua richiesto rendono il fit incerto rispetto all'esperienza attuale del candidato, prevalentemente individual contributor.\nNOTE_MISMATCH: [SENIORITY] Richiesta esperienza di management di team, il candidato non ha mai gestito persone direttamente.\nNOTE_MISMATCH: [LANGUAGE] Tedesco quasi madrelingua preferito, livello del candidato è intermedio.",
    scoreNotes:
      "Ruolo di leadership con quota molto alta e requisito di management non ancora coperto dal candidato, ma il fit di settore B2B tech resta buono.",
    criticNotes:
      "Round 1: 5/10, Round 2: 4/10. Verdict: NEEDS_WORK. Gap: il CV non riesce a dimostrare esperienza di people management concreta, punto bloccante per un ruolo di Sales Manager con team diretto. Strength: buon storytelling sui risultati individuali di vendita B2B, ma serve riformulare o scartare la candidatura senza inventare esperienza di gestione team mai avuta.",
    addr: "Neue Mainzer Strasse 20, 60311 Frankfurt am Main",
  },
  {
    title: "Head of Growth",
    company: "Sundial Tech",
    city: "amsterdam",
    remote: "full_remote",
    sal: [95000, 120000, "EUR"],
    source: "LinkedIn",
    status: "ready",
    score: 92,
    family: "Growth",
    h: 6,
    critic: [9, "PASS"],
    jd: "Consumer wellness app with 1.2M downloads hiring a Head of Growth to own the full acquisition and monetization P&L, leading a team of 4 across paid UA, ASO and lifecycle, reporting directly to the CEO with board-level visibility.",
    jdFull:
      "Sundial Tech builds a consumer wellness app combining sleep tracking, guided breathing and habit coaching, with 1.2M downloads and a fast-growing subscription base.\n\nThe Role\nWe're hiring a Head of Growth to own our entire acquisition and monetization strategy, leading a team of 4 (paid, lifecycle, ASO) and reporting directly to the CEO.\n\nWhat You'll Do\n- Own the growth P&L: acquisition spend, LTV, subscription conversion\n- Lead and grow a team of 4 growth specialists\n- Set the experimentation roadmap across paid UA, ASO and lifecycle\n- Present growth strategy and results at monthly board meetings\n- Own the relationship with our UA agency partners\n\nWhat We Offer\n- Fully remote, occasional travel to Amsterdam HQ (quarterly)\n- Meaningful equity package\n- €2,000/year wellness and learning budget\n- Direct line to the CEO, real ownership of the growth function\n\nRequirements\n- 7+ years in growth marketing, 3+ years in a leadership role\n- Track record scaling a consumer subscription app\n- Deep knowledge of mobile UA, ASO and subscription monetization\n- Comfortable presenting to a board\n- English fluent",
    req: [
      "7+ years in growth marketing, 3+ years in a leadership role",
      "Track record scaling a consumer subscription app",
      "Deep knowledge of mobile UA, ASO and subscription monetization",
      "Comfortable presenting to a board",
      "English fluent",
    ],
    pros: [
      "Ruolo di leadership con P&L reale sotto il proprio controllo",
      "Full remote con equity significativa",
      "Accesso diretto al CEO",
    ],
    cons: ["Viaggi trimestrali richiesti ad Amsterdam"],
    notes:
      "SENIORITY_JD: lead\nEXPERIENCE_REQUIRED: 7+ years, incl. 3+ leadership\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Inglese fluente\n\nRuolo di leadership growth di alto profilo, forte coerenza con il percorso del candidato su acquisizione ed esperimenti, esposizione board una novità positiva rispetto ai ruoli precedenti.",
    scoreNotes:
      "Ottimo allineamento su growth leadership, subscription mobile ed esperienza di board reporting: uno dei fit migliori del batch.",
    criticNotes:
      "Round 1: 8/10, Round 2: 9/10, Round 3: 9/10. Verdict: PASS. Strength: narrativa solida su scaling di growth team e ownership P&L, coerente con esperienza pregressa documentata. Gap: subscription mobile specifica limitata, mitigato evidenziando l'esperienza analoga su funnel di conversione freemium.",
  },
  {
    title: "Senior Performance Marketing Manager",
    company: "Farview",
    city: "london",
    remote: "hybrid",
    sal: [65000, 85000, "GBP"],
    source: "eFinancialCareers",
    status: "ready",
    score: 88,
    family: "Performance Ads",
    h: 18,
    critic: [8, "PASS"],
    jd: "UK retail investing app hiring a Senior Performance Marketing Manager to own a £600k/month paid acquisition budget across Meta, Google, TikTok and programmatic, working with Compliance on FCA-compliant creative and running incrementality/MMM measurement.",
    jdFull:
      "Farview is a retail investing app with 500,000 active users in the UK and EU, competing on low fees and an intuitive onboarding experience.\n\nThe Role\nWe're hiring a Senior Performance Marketing Manager to own paid acquisition across a £600k/month budget, with a strong focus on regulatory-compliant creative and incrementality measurement.\n\nWhat You'll Do\n- Own paid media strategy across Meta, Google, TikTok and programmatic\n- Manage a £600k/month budget and report weekly to the CMO\n- Work with Legal/Compliance on FCA-compliant ad creative\n- Run incrementality tests and MMM to validate channel ROI\n- Mentor two mid-level performance marketers\n\nWhat We Offer\n- Hybrid, three days a week at our Canary Wharf office\n- Discretionary annual bonus\n- Private healthcare and pension matching\n- High-visibility role with direct CMO access\n\nRequirements\n- 6+ years in performance marketing, fintech or regulated industry a plus\n- Experience managing 6-figure monthly budgets\n- Familiarity with incrementality testing or MMM\n- Comfortable working with Legal/Compliance on ad review\n- Right to work in the UK",
    req: [
      "6+ years in performance marketing, fintech or regulated industry a plus",
      "Experience managing 6-figure monthly budgets",
      "Familiarity with incrementality testing or MMM",
      "Comfortable working with Legal/Compliance on ad review",
      "Right to work in the UK",
    ],
    pros: [
      "Budget di scala importante (£600k/mese)",
      "Mentoring di due persone, primo passo verso leadership",
      "Accesso diretto al CMO",
    ],
    cons: ["Diritto di lavoro UK da confermare"],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 6+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Inglese fluente\n\nRuolo senior di performance marketing con budget importante, ottima coerenza con l'esperienza pregressa del candidato su gestione budget a sei cifre e incrementality testing.\nNOTE_MISMATCH: [GEO] Diritto di lavoro nel Regno Unito richiesto, da verificare lo status visa del candidato.",
    scoreNotes:
      "Match molto forte su scala di budget ed expertise di incrementality testing, unico punto da chiarire è il diritto di lavoro UK post-Brexit.",
    criticNotes:
      "Round 1: 7/10, Round 2: 8/10, Round 3: 8/10. Verdict: PASS. Strength: esperienza documentata su budget a sei cifre e test di incrementalità, ottimo match tecnico. Gap: nessuna esperienza diretta in settore regolamentato/fintech, mitigato mostrando adattabilità dimostrata su compliance in altri contesti.",
    addr: "40 Bank Street, London E14 5NR",
  },
  {
    title: "Brand Director",
    company: "Cobblestone",
    city: "zurich",
    remote: "hybrid",
    sal: [110000, 135000, "CHF"],
    source: "jobs.ch",
    status: "ready",
    score: 91,
    family: "Brand",
    h: 24,
    critic: [9, "PASS"],
    jd: "Accessible-luxury watch and jewelry brand hiring a Brand Director to own strategy, creative direction and a CHF 2.5M annual budget, leading a team of 5 and reporting directly to the CMO with quarterly executive presentations.",
    jdFull:
      "Cobblestone sells fine watches and jewelry online and through three flagship boutiques, positioned as an accessible-luxury alternative to legacy Swiss watchmakers.\n\nThe Role\nWe're hiring a Brand Director to own brand strategy, creative direction and campaign leadership across our digital and boutique presence, reporting to the CMO.\n\nWhat You'll Do\n- Own brand strategy and positioning across all touchpoints\n- Lead a team of 5 (creative, PR, content) and manage external agencies\n- Direct seasonal campaigns and boutique launch events\n- Own the brand budget (~CHF 2.5M annually)\n- Present brand performance and strategy to the executive team quarterly\n\nWhat We Offer\n- Hybrid, three days a week in our Zurich boutique-adjacent office\n- Highly competitive compensation with annual bonus\n- Product allowance\n- Small, senior leadership team with real creative latitude\n\nRequirements\n- 8+ years in brand marketing, 3+ years in a director-level role\n- Experience in luxury, fashion or premium consumer goods\n- Track record leading creative teams and agency relationships\n- Comfortable presenting to C-level executives\n- German and English fluent",
    req: [
      "8+ years in brand marketing, 3+ years in a director-level role",
      "Experience in luxury, fashion or premium consumer goods",
      "Track record leading creative teams and agency relationships",
      "Comfortable presenting to C-level executives",
      "German and English fluent",
    ],
    pros: [
      "Budget brand importante (CHF 2.5M)",
      "Compenso molto competitivo con bonus",
      "Latitudine creativa reale a livello direttivo",
    ],
    cons: ["Settore luxury/watches mai esplorato direttamente"],
    notes:
      "SENIORITY_JD: lead\nEXPERIENCE_REQUIRED: 8+ years, incl. 3+ director-level\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Tedesco + Inglese\n\nRuolo di leadership brand di alto livello, forte coerenza sulla parte di gestione team e budget, il settore luxury è nuovo ma la seniority e le competenze trasversali di brand management sono solide.\nNOTE_MISMATCH: [DOMAIN] Settore luxury/watches mai coperto direttamente, richiede storytelling su transferable skills in colloquio.",
    scoreNotes:
      "Seniority e competenze di leadership brand pienamente allineate, il settore luxury è nuovo ma non blocca il fit su un ruolo di questo livello.",
    criticNotes:
      "Round 1: 8/10, Round 2: 9/10, Round 3: 9/10. Verdict: PASS. Strength: solida esperienza di leadership brand e gestione budget multimilionario, ben documentata nel CV. Gap: assenza di esperienza diretta nel settore luxury, gestita nel CV enfatizzando competenze trasferibili senza inventare storia nel settore.",
    addr: "Bahnhofstrasse 64, 8001 Zürich",
  },
  {
    title: "Senior CRM Manager",
    company: "Quietstorm",
    city: "lisbon",
    remote: "full_remote",
    sal: [58000, 74000, "EUR"],
    source: "Wellfound",
    status: "ready",
    score: 85,
    family: "CRM & Email",
    h: 33,
    critic: [8, "PASS"],
    jd: "Martech platform for lifecycle orchestration hiring a Senior CRM Manager to run their own internal lifecycle marketing as a reference customer, advising the product roadmap and mentoring a junior CRM executive, fully remote.",
    jdFull:
      "Quietstorm builds a martech platform for lifecycle orchestration, used by mid-market ecommerce brands to unify email, SMS and push into a single customer-data view.\n\nThe Role\nWe're hiring a Senior CRM Manager to lead by example on our own product: running Quietstorm's internal lifecycle marketing while also acting as a reference customer for our sales team.\n\nWhat You'll Do\n- Own end-to-end lifecycle marketing for Quietstorm's own customer base\n- Design advanced segmentation and predictive-churn flows using our own platform\n- Serve as a product advisor, feeding customer-facing feedback to the roadmap\n- Support Sales with live demos of advanced use cases\n- Mentor a Junior CRM Executive\n\nWhat We Offer\n- Fully remote, EU timezone\n- Deep product access and influence on the roadmap\n- €1,000/year learning budget\n- Small, senior team with high autonomy\n\nRequirements\n- 5+ years in CRM/lifecycle marketing, martech or ecommerce preferred\n- Deep segmentation and predictive-flow experience\n- Comfortable being both a practitioner and a product advocate\n- Mentoring experience a plus\n- English fluent",
    req: [
      "5+ years in CRM/lifecycle marketing, martech or ecommerce preferred",
      "Deep segmentation and predictive-flow experience",
      "Comfortable being both a practitioner and a product advocate",
      "Mentoring experience a plus",
      "English fluent",
    ],
    pros: [
      "Ruolo ibrido pratica/prodotto, crescita naturale di carriera",
      "Full remote EU senza vincoli",
      "Accesso diretto alla roadmap di prodotto",
    ],
    cons: [
      "Team piccolo, meno struttura formale rispetto a organizzazioni più grandi",
    ],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 5+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Inglese fluente\n\nRuolo CRM senior con doppia natura pratica/prodotto, molto coerente con l'esperienza del candidato su segmentazione e piattaforme CRM, ruolo dogfooding interessante e raro.",
    scoreNotes:
      "Fit eccellente sulle competenze CRM core, il ruolo ibrido pratica/prodotto è una crescita naturale rispetto al percorso del candidato.",
    criticNotes:
      "Round 1: 7/10, Round 2: 8/10, Round 3: 8/10. Verdict: PASS. Strength: esperienza CRM/lifecycle molto solida e ben documentata, il doppio ruolo pratica/prodotto è raccontato in modo credibile nel CV. Gap: nessuna esperienza pregressa di mentoring formale, presentata come area di crescita senza inventare claim.",
  },
  {
    title: "Head of Product Marketing",
    company: "Marrowbrook",
    city: "dublin",
    remote: "hybrid",
    sal: [88000, 115000, "EUR"],
    source: "LinkedIn",
    status: "applied",
    score: 84,
    family: "Product Marketing",
    h: 160,
    critic: [7, "PASS"],
    jd: "API observability devtools platform ahead of a Series C, hiring a Head of Product Marketing to build the function from scratch, own analyst relations and report directly to the CMO with board visibility.",
    jdFull:
      "Marrowbrook builds a devtools platform for API observability, used by engineering teams at over 500 companies to monitor and debug production API traffic.\n\nThe Role\nWe're hiring a Head of Product Marketing to build the function from the ground up, owning positioning, launches and analyst relations as we prepare for a Series C.\n\nWhat You'll Do\n- Build the product marketing function, hiring 2 people in year one\n- Own positioning and messaging across the full product suite\n- Lead analyst relations (Gartner, Forrester) ahead of Series C\n- Partner with Sales leadership on enablement and competitive positioning\n- Report to the CMO with visibility to the board\n\nWhat We Offer\n- Hybrid, two days a week in our Dublin office\n- Meaningful equity as an early leadership hire\n- Budget to build out the team and function\n- Direct board exposure\n\nRequirements\n- 7+ years in product marketing, 2+ years in a leadership role\n- Experience building a product marketing function from scratch\n- Analyst relations experience a strong plus\n- Comfortable with board-level reporting\n- English fluent",
    req: [
      "7+ years in product marketing, 2+ years in a leadership role",
      "Experience building a product marketing function from scratch",
      "Analyst relations experience a strong plus",
      "Comfortable with board-level reporting",
      "English fluent",
    ],
    pros: [
      "Ruolo fondativo con budget per costruire il team",
      "Equity significativa come early leadership hire",
      "Visibilità diretta al board",
    ],
    cons: ["Analyst relations mai gestita direttamente in precedenza"],
    notes:
      "SENIORITY_JD: lead\nEXPERIENCE_REQUIRED: 7+ years, incl. 2+ leadership\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Inglese fluente\n\nRuolo di leadership per costruire la funzione product marketing da zero, ottima coerenza con il percorso del candidato su positioning e launches, l'analyst relations è l'unica area meno coperta in precedenza.\nNOTE_MISMATCH: [DOMAIN] Analyst relations (Gartner/Forrester) mai gestita direttamente dal candidato.",
    scoreNotes:
      "Ottimo fit su costruzione della funzione e positioning, gap contenuto sull'analyst relations che non è bloccante per un ruolo di questo livello.",
    criticNotes:
      "Round 1: 6/10, Round 2: 7/10, Round 3: 7/10. Verdict: PASS. Strength: esperienza solida nel costruire processi di positioning e launch, ben supportata da esempi concreti nel CV. Gap: assenza di analyst relations diretta, il CV la presenta come area di crescita senza inventare rapporti con Gartner/Forrester mai avuti.",
  },
  {
    title: "Sales Director, Nordics",
    company: "Fieldstone",
    city: "oslo",
    remote: "hybrid",
    sal: [950000, 1150000, "NOK"],
    source: "LinkedIn",
    status: "applied",
    score: 79,
    family: "Sales",
    h: 168,
    critic: [7, "PASS"],
    jd: "Nordic energy-management SaaS building out its regional sales function, hiring a Sales Director to own an NOK 18M ARR quota, hire and lead a team of Account Executives across Norway, Sweden and Denmark, reporting to the VP of Sales EMEA.",
    jdFull:
      "Fieldstone builds energy-management software for commercial buildings, helping property owners cut energy costs and meet emerging Nordic sustainability regulations.\n\nThe Role\nWe're hiring a Sales Director, Nordics to build and lead our regional sales function, currently at 3 Account Executives and growing, reporting to the VP of Sales EMEA.\n\nWhat You'll Do\n- Own the Nordics new-business quota (NOK 18M ARR annually)\n- Hire and manage a team of Account Executives across Norway, Sweden and Denmark\n- Build the regional go-to-market playbook alongside Marketing\n- Represent Fieldstone at key Nordic cleantech and real estate events\n- Report quarterly to the VP of Sales EMEA and executive team\n\nWhat We Offer\n- Hybrid, three days a week in our Oslo office\n- Competitive base + team-performance bonus\n- Equity package\n- High-impact role in a regulation-driven growth market\n\nRequirements\n- 6+ years in B2B SaaS sales, 2+ years managing a team\n- Experience selling into real estate, energy or cleantech a strong plus\n- Comfortable owning a multi-country quota\n- Norwegian or Swedish fluent, English fluent\n- Track record of team-building in a growth-stage company",
    req: [
      "6+ years in B2B SaaS sales, 2+ years managing a team",
      "Experience selling into real estate, energy or cleantech a strong plus",
      "Comfortable owning a multi-country quota",
      "Norwegian or Swedish fluent, English fluent",
      "Track record of team-building in a growth-stage company",
    ],
    pros: [
      "Mercato cleantech in forte espansione regolatoria",
      "Ruolo fondativo per la funzione sales regionale",
    ],
    cons: ["Lingua nordica fluente richiesta, da chiarire in colloquio"],
    notes:
      "SENIORITY_JD: lead\nEXPERIENCE_REQUIRED: 6+ years, incl. 2+ management\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Norvegese o Svedese fluente\n\nRuolo di leadership sales in un mercato regolatorio in crescita, buona coerenza sulla parte di team-building e quota multi-paese; la lingua nordica fluente resta il principale punto da chiarire.\nNOTE_MISMATCH: [LANGUAGE] Norvegese o svedese fluente richiesto, il candidato lavora in inglese.",
    scoreNotes:
      "Buon fit sulla leadership sales e sul mercato cleantech in crescita, penalizzato dal requisito linguistico nordico non confermato.",
    criticNotes:
      "Round 1: 6/10, Round 2: 7/10, Round 3: 7/10. Verdict: PASS. Strength: solido track record di vendita B2B SaaS e gestione quota, ben rappresentato nel CV. Gap: competenza linguistica nordica non confermata, il CV non ne fa menzione e non viene inventata.",
    addr: "Karl Johans gate 16, 0154 Oslo",
  },
  {
    title: "Senior Growth Marketer",
    company: "Northstar Labs",
    city: "berlin",
    remote: "full_remote",
    sal: [68000, 84000, "EUR"],
    source: "LinkedIn",
    status: "response",
    score: 86,
    family: "Growth",
    h: 180,
    critic: [8, "PASS"],
    jd: "B2B SaaS acquisition platform expanding its growth pod with a Senior Growth Marketer focused on EMEA localization and market expansion, co-leading experimentation with the existing Growth Marketing Manager and reporting to the Head of Growth.",
    jdFull:
      "Northstar Labs is the B2B SaaS acquisition-funnel platform behind our existing Growth Marketing Manager opening, now expanding the growth pod with a second senior hire to cover EMEA expansion.\n\nThe Role\nWe're hiring a Senior Growth Marketer to co-lead experimentation alongside our Growth Marketing Manager, with a specific focus on EMEA market expansion and localization.\n\nWhat You'll Do\n- Lead EMEA-focused acquisition experiments across paid, lifecycle and organic\n- Own localization strategy for landing pages and onboarding flows in 3 new markets\n- Partner with the existing growth pod on shared experimentation infrastructure\n- Present monthly results to the Head of Growth\n- Support hiring for a Growth Analyst role opening next quarter\n\nWhat We Offer\n- Fully remote EU\n- Same team and benefits as our existing growth pod: budget for experiments, learning stipend\n- Stock options\n- High-autonomy senior IC role with a path to team lead\n\nRequirements\n- 5+ years in growth/performance roles\n- Experience with market localization and international expansion\n- Hands-on with GA4, attribution and SQL\n- Track record of independent experiment ownership\n- English fluent, additional EU language a plus",
    req: [
      "5+ years in growth/performance roles",
      "Experience with market localization and international expansion",
      "Hands-on with GA4, attribution and SQL",
      "Track record of independent experiment ownership",
      "English fluent, additional EU language a plus",
    ],
    pros: [
      "Azienda già nota al candidato con reputazione positiva",
      "Full remote EU con team growth strutturato",
      "Percorso verso team lead",
    ],
    cons: ["Localizzazione multi-mercato mai gestita in prima persona"],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 5+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Inglese fluente\n\nRuolo molto simile al Growth Marketing Manager già valutato per la stessa azienda, con focus aggiuntivo su localizzazione EMEA. Ottima coerenza con l'esperienza di growth ed esperimenti del candidato, azienda già nota e apprezzata.",
    scoreNotes:
      "Fit quasi identico al ruolo gemello già in pipeline, con l'aggiunta di localizzazione EMEA che il candidato non ha ancora praticato ma che si innesta su competenze solide.",
    criticNotes:
      "Round 1: 7/10, Round 2: 8/10, Round 3: 8/10. Verdict: PASS. Strength: esperienza di growth ed esperimenti molto solida e già validata su un ruolo gemello nella stessa azienda. Gap: esperienza di localizzazione EMEA limitata, il CV la inquadra come area di crescita naturale senza sovrastimarla.",
  },
  {
    title: "Retail Sales Associate",
    company: "PromoPlus",
    city: "napoli_x",
    remote: "onsite",
    sal: [17000, 22000, "EUR"],
    source: "Indeed",
    status: "excluded",
    score: 22,
    family: "Sales",
    h: 190,
    jd: "Promotional staffing agency in Campania looking for a Retail Sales Associate for direct sales and product sampling in shopping malls, flexible shifts six days a week with unpaid initial training.",
    jdFull:
      "PromoPlus supplies promotional and sales staff for in-store events, shopping malls, and third-party sampling campaigns across the Campania region.\n\nThe Role\nWe are looking for a Retail Sales Associate for direct sales and product promotion activities at partner retail locations, with flexible shifts six days a week.\n\nWhat You'll Do\n- Staff promotional stands in shopping malls\n- Pitch sample products to passing customers\n- Hit daily sales targets\n- Handle petty cash and sales reporting at the end of each shift\n\nWhat We Offer\n- Fixed pay plus commission on sales\n- Initial 3-day unpaid training\n- Shifts assigned weekly, weekend availability required\n\nRequirements\n- No experience required\n- Presentable appearance and a knack for sales\n- Full-time availability six days a week",
    cons: [
      "Retribuzione ben sotto la soglia minima",
      "Formazione iniziale non retribuita",
      "Turni sei giorni su sette senza flessibilità",
    ],
    notes:
      "EXCLUDED: [SALARY] Retribuzione stimata 17-22k annui con formazione iniziale non retribuita e turni sei giorni su sette, ben sotto la soglia minima accettabile e coerente con il pattern già visto sulla posizione gemella Door-to-door Sales Promoter della stessa azienda.",
    scoreNotes:
      "Retribuzione minima, formazione non pagata e disponibilità sei giorni su sette: fuori target su ogni dimensione rilevante per il profilo del candidato.",
  },
];
