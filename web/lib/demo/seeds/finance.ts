// [JHT-WEB-DEMO] Seed posizioni demo — persona "finance" (56 posizioni).
// File generato: per rigenerarlo si passa dai JSON dello sciame di
// arricchimento e dal converter (23/07); a mano si edita come un normale
// array TS. L'ORDINE determina id/legacy_id: aggiungere solo in coda.
import type { Seed } from "../data";

export const FINANCE: Seed[] = [
  {
    title: "Senior FP&A Analyst",
    company: "FinPilot",
    city: "amsterdam",
    remote: "hybrid",
    sal: [65000, 80000, "EUR"],
    source: "LinkedIn",
    status: "ready",
    score: 89,
    family: "FP&A",
    h: 8,
    critic: [8, "PASS"],
    jd: "FinPilot is a fast-growing European fintech scale-up building embedded lending infrastructure for SMEs. You'll own the operating model, run the monthly forecast cycle, and prepare the board reporting pack, partnering closely with product leads on unit economics for each new lending line. The role sits inside a lean 6-person finance team reporting directly to the CFO.",
    jdFull:
      "FinPilot is on a mission to make working capital instantly accessible to European SMEs. Since our Series B we've scaled lending volume 4x and are now building out a finance function that can keep pace with a business doubling headcount every 12 months.\n\nThe Role\nAs Senior FP&A Analyst you will own the group operating model end to end: monthly forecast cycle, variance analysis, and the board reporting pack that goes straight to our investors. You'll partner with product and lending leads to build unit economics for each new product line, and help the CFO turn spreadsheet chaos into a proper driver-based model.\n\nWhat you'll do\n- Run the monthly forecast and close cycle, coordinating inputs from Sales, Product and Risk\n- Build and maintain driver-based models for lending volume, take rate and cost of risk\n- Prepare board decks and investor reporting packs\n- Partner with product leads on unit economics for new lending products\n- Support ad hoc analysis for pricing and capital allocation decisions\n\nWhat we offer\n- Competitive salary plus equity\n- Hybrid working from our Amsterdam canal-side office, 3 days on site\n- Direct exposure to the CFO and leadership team\n- 26 days holiday plus local public holidays\n\nWe are an equal opportunity employer and welcome applications from all backgrounds.",
    req: [
      "4+ years FP&A experience in tech, fintech or consulting",
      "Advanced driver-based financial modelling in Excel/Sheets",
      "SQL and BI tooling (Looker or similar) a strong plus",
      "Experience presenting directly to CFO/board level",
      "Fluent English, Dutch a plus but not required",
    ],
    pros: [
      "Esposizione diretta al CFO e al board",
      "Modello operativo moderno, non solo Excel",
      "Stack SQL/BI in linea con le competenze del candidato",
    ],
    cons: [
      "Ciclo di chiusura mensile intenso, poco spazio di manovra nei picchi",
    ],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 4+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: English\n\nRuolo FP&A senior presso fintech scale-up olandese in forte crescita, in linea con l'esperienza pregressa del candidato su forecasting e modelli driver-based. Il riferimento diretto al CFO e la richiesta di SQL/BI confermano un contesto data-driven coerente col profilo. Nessuna barriera linguistica, l'inglese è sufficiente.\nNOTE_MISMATCH: [GEO] Ibrido 3 giorni ad Amsterdam, richiede possibile trasferimento o pendolarismo frequente.",
    scoreNotes:
      "Punteggio alto: seniority, stack di modellazione e contesto fintech tutti allineati al profilo; unico limite è il ritmo di chiusura mensile serrato.",
    criticNotes:
      "Round 1: 7/10, Round 2: 8/10, Round 3: 8/10. Verdict: PASS. Strength: forecasting driver-based e reporting verso board ben documentati nel CV, con evidenza concreta su SQL. Gap: nessuna esperienza diretta in lending fintech, ma il transfer da FP&A tech è stato argomentato senza inventare claim.",
    addr: "Herengracht 182, 1016 BR Amsterdam",
  },
  {
    title: "Financial Controller",
    company: "AtlasCare",
    city: "milano",
    remote: "hybrid",
    sal: [55000, 68000, "EUR"],
    source: "LinkedIn",
    status: "ready",
    score: 84,
    family: "Accounting",
    h: 15,
    critic: [7, "PASS"],
    jd: "AtlasCare is a healthtech scale-up digitising home care services across Italy. The Financial Controller will own monthly and annual closing under IFRS, coordinate the external audit, and drive the migration to NetSuite from a legacy ERP. You'll work closely with the Finance Manager in a young, fast-moving team based in central Milan.",
    jdFull:
      "AtlasCare connects patients with vetted home-care professionals across Italy, and we're scaling fast after closing our Series A. Our finance team is small but ambitious, and we're looking for a Financial Controller to bring structure to our closing and reporting processes.\n\nThe Role\nYou will own the monthly and annual closing cycle under IFRS, coordinate with our external auditors, and lead the improvement of our ERP setup as we migrate onto NetSuite. You'll work hand in hand with the Finance Manager and report into the Head of Finance.\n\nWhat you'll do\n- Run monthly and year-end closing in compliance with IFRS\n- Coordinate statutory audit and manage auditor relationship\n- Lead NetSuite implementation and process automation\n- Prepare management reporting packs for leadership\n- Support tax compliance filings with our external advisors\n\nWhat we offer\n- Clear growth path towards Finance Manager within 18-24 months\n- Hybrid model, 2 days per week in our Milan office near Porta Romana\n- Young, collaborative team with real ownership from day one\n- Meal vouchers and health insurance\n\nOpen to candidates who bring rigor and want to build finance processes from scratch.",
    req: [
      "Experience running IFRS monthly/annual closing",
      "NetSuite or similar cloud ERP experience",
      "Italian and English fluency",
      "Statutory audit coordination experience",
      "Comfortable in a fast-changing scale-up environment",
    ],
    pros: [
      "Percorso di crescita chiaro verso Finance Manager",
      "Team giovane con forte ownership",
      "Esperienza IFRS del candidato ben allineata",
    ],
    cons: ["Ibrido solo 2 giorni a Milano, il resto remoto"],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3-5 anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: Italian + English\n\nRuolo di Financial Controller in healthtech scale-up italiana, chiusura IFRS e migrazione NetSuite in linea con il background del candidato in contabilità e controllo. Team giovane con percorso di crescita esplicito verso Finance Manager, buon segnale di stabilità nonostante la fase early-stage.\nNOTE_MISMATCH: [STACK] NetSuite richiesto come plus, il candidato ha esperienza equivalente solo su SAP.",
    scoreNotes:
      "Buon punteggio: esperienza IFRS e coordinamento audit centrati, gap minore sullo specifico ERP NetSuite compensato da esperienza SAP trasferibile.",
    criticNotes:
      "Round 1: 6/10, Round 2: 7/10, Round 3: 7/10. Verdict: PASS. Strength: closing IFRS e coordinamento audit documentati con esempi concreti. Gap: NetSuite non presente in CV, il claim resta sull'esperienza SAP equivalente senza forzature.",
  },
  {
    title: "Risk Analyst, Credit",
    company: "NovaPay",
    city: "dublin",
    remote: "hybrid",
    sal: [58000, 72000, "EUR"],
    source: "Wellfound",
    status: "ready",
    score: 86,
    family: "Risk & Audit",
    h: 24,
    critic: [8, "PASS"],
    jd: "NovaPay is a consumer lending fintech operating across the Irish and UK markets. As Risk Analyst you'll build and maintain credit scorecards, monitor portfolio performance, and support IFRS 9 provisioning models within a strong quantitative risk team.",
    jdFull:
      "NovaPay provides responsible short-term consumer credit to underserved customers in Ireland and the UK. Our risk team is the engine room of the business, and we're growing it to support our next phase of lending volume.\n\nThe Role\nAs Risk Analyst, Credit you will build and refine credit scorecards, monitor portfolio performance across vintages, and support the provisioning models required under IFRS 9. You'll work in a tight-knit team of quants and risk managers who take ownership of the full model lifecycle.\n\nWhat you'll do\n- Develop and validate credit scorecards using Python\n- Monitor delinquency, roll rates and portfolio KPIs\n- Support IFRS 9 provisioning model development and documentation\n- Present risk trends to the Risk Committee\n- Work with Data Engineering to expand the risk data warehouse\n\nWhat we offer\n- Competitive salary with annual bonus\n- Hybrid working from our Dublin 2 office, 3 days on site\n- Rich internal dataset spanning several years of lending history\n- Structured mentorship from senior risk quants\n\nWe value evidence-based decision making and want analysts who are comfortable challenging assumptions with data.",
    req: [
      "Credit risk modelling experience (scorecards, PD/LGD)",
      "Python or R for statistical modelling",
      "IFRS 9 provisioning exposure",
      "Comfortable presenting to Risk Committee",
      "Degree in a quantitative field",
    ],
    pros: [
      "Team quantitativo forte con dataset ricco e storico",
      "Esposizione diretta a Risk Committee",
      "Stack Python allineato al profilo",
    ],
    cons: ["Contesto fortemente regolamentato, ritmi da audit periodici"],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: required\nLANGUAGE_REQUIRED: English\n\nRuolo di Risk Analyst in fintech di consumer lending con team quantitativo strutturato, in forte continuità con l'esperienza del candidato su scorecard e Python. La componente IFRS 9 è presente ma non centrale nel CV, comunque coperta a livello di comprensione teorica.\nNOTE_MISMATCH: [DOMAIN] Consumer lending regolamentato UK/IE, il candidato ha esperienza prevalente su e-commerce risk, dominio adiacente ma non identico.",
    scoreNotes:
      "Punteggio alto: stack Python e modellazione credit risk ben coperti, piccolo gap di dominio (consumer lending regolamentato) compensato da forte base quantitativa.",
    criticNotes:
      "Round 1: 8/10, Round 2: 8/10, Round 3: 8/10. Verdict: PASS. Strength: scorecard building e Python documentati con progetti concreti nel CV. Gap: esperienza IFRS 9 diretta limitata, CV la presenta come formazione più che pratica senza inventare claim.",
    addr: "32 Fitzwilliam Square, Dublin 2",
  },
  {
    title: "Business Analyst, Strategy",
    company: "Mosaic Cloud",
    city: "paris",
    remote: "hybrid",
    sal: [55000, 70000, "EUR"],
    source: "Welcome to the Jungle",
    status: "ready",
    score: 82,
    family: "Business Analysis",
    h: 32,
    critic: [7, "PASS"],
    jd: "Mosaic Cloud is a B2B SaaS scale-up expanding across European markets. The Business Analyst, Strategy will support the COO on pricing strategy, market sizing and expansion business cases, working across a small team that reports directly into the executive committee.",
    jdFull:
      "Mosaic Cloud helps mid-market companies orchestrate their multi-cloud infrastructure. After a strong Series B we're expanding aggressively across new EU markets and need a Business Analyst to support the COO's strategy agenda.\n\nThe Role\nYou will support pricing strategy work, build market sizing models for new geographies, and prepare expansion business cases presented directly to the executive committee. This is a highly visible role with real influence on where and how we expand next.\n\nWhat you'll do\n- Build market sizing and TAM/SAM models for candidate expansion markets\n- Support pricing strategy analysis alongside Product and Sales\n- Prepare business cases and board-level presentations\n- Run competitive intelligence and benchmarking exercises\n- Partner with Finance on the ROI of expansion investments\n\nWhat we offer\n- Direct, regular exposure to the COO and executive committee\n- Hybrid working from our Paris office near République\n- Fast career growth in a company scaling headcount 60% year on year\n- Annual travel budget for market visits\n\nWe're looking for someone who thinks like an owner and is comfortable with ambiguity.",
    req: [
      "2-4 years in consulting, BizOps or strategy",
      "Strong financial modelling and storytelling skills",
      "Comfortable building TAM/SAM/market sizing models",
      "French language a plus, not mandatory",
      "Experience presenting to senior stakeholders",
    ],
    pros: [
      "Progetti trasversali con esposizione C-level",
      "Azienda in crescita rapida, ruolo di forte visibilità",
    ],
    cons: ["Trasferte mensili per visite di mercato"],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2-4 years\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: English, French preferred\n\nRuolo di Business Analyst strategico in SaaS scale-up francese, con forte enfasi su modelling e storytelling in linea con l'esperienza da consulenza del candidato. Il francese è indicato come plus non vincolante, quindi non rappresenta una barriera reale.\nNOTE_MISMATCH: [LANGUAGE] Il francese non è richiesto obbligatoriamente ma è probabilmente atteso nelle interazioni quotidiane con team locali.",
    scoreNotes:
      "Buon punteggio: profilo da consulenza e capacità di modelling centrate sul ruolo; le trasferte mensili e il francese come plus riducono leggermente il fit rispetto a ruoli full-local.",
    criticNotes:
      "Round 1: 7/10, Round 2: 7/10, Round 3: 7/10. Verdict: PASS. Strength: esperienza in business case e market sizing ben documentata nel CV. Gap: francese non presente come lingua lavorativa, il CV non lo rivendica.",
  },
  {
    title: "Treasury Analyst",
    company: "Helvetia Systems",
    city: "zurich",
    remote: "hybrid",
    sal: [95000, 115000, "CHF"],
    source: "LinkedIn",
    status: "applied",
    score: 81,
    family: "Treasury",
    h: 88,
    critic: [7, "PASS"],
    jd: "Helvetia Systems is a Swiss industrial group with treasury operations spanning multiple currencies. The Treasury Analyst will manage day-to-day cash positioning, execute FX hedging strategies, and support long-term liquidity planning for the group.",
    jdFull:
      "Helvetia Systems manufactures precision components for the automotive and industrial sectors, with operations across Switzerland, Germany and Poland. Our treasury function manages significant cross-currency exposure and is looking for an analyst to strengthen the team.\n\nThe Role\nYou will manage daily cash positioning across group entities, execute FX hedging strategies in line with treasury policy, and contribute to long-term liquidity planning. You'll work closely with the Group Treasurer and interact regularly with our banking partners.\n\nWhat you'll do\n- Monitor daily cash positions across multiple currencies and entities\n- Execute FX hedges (forwards, swaps) within approved limits\n- Support quarterly liquidity forecasting and covenant reporting\n- Maintain relationships with relationship banks\n- Assist with treasury system (Kyriba) administration\n\nWhat we offer\n- Competitive Swiss salary and pension contributions\n- Hybrid model, 3 days at our Zurich headquarters\n- Structured exposure to group-level treasury strategy\n- Ongoing training budget for treasury certifications (AMCT, etc.)\n\nWe look for candidates with strong numerical rigor and attention to detail.",
    req: [
      "2-4 years treasury or cash management experience",
      "FX hedging exposure (forwards, swaps)",
      "Experience with treasury management systems (Kyriba or similar)",
      "Strong Excel and financial modelling skills",
      "German a plus, English mandatory",
    ],
    pros: [
      "Esposizione a strategia treasury di gruppo multi-valuta",
      "Pacchetto retributivo svizzero elevato",
    ],
    cons: [
      "Tedesco utile ma non posseduto dal candidato, potenziale barriera nelle interazioni locali",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2-4 years\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: English, German a plus\n\nRuolo Treasury Analyst in gruppo industriale svizzero con esposizione multi-valuta, coerente con l'esperienza del candidato su cash management e FX. Il tedesco è indicato come plus, non blocca la candidatura ma limita l'integrazione locale.\nNOTE_MISMATCH: [LANGUAGE] Tedesco non posseduto dal candidato, indicato come plus ma probabilmente utile nelle interazioni con banche locali.",
    scoreNotes:
      "Punteggio solido: FX hedging e cash management centrati sul profilo, il gap linguistico sul tedesco è un plus mancante non un requisito bloccante.",
    criticNotes:
      "Round 1: 7/10, Round 2: 7/10, Round 3: 7/10. Verdict: PASS. Strength: gestione cash flow multi-currency e FX hedging documentati con esempi concreti. Gap: nessuna certificazione treasury (AMCT), CV non la rivendica.",
    addr: "Bahnhofstrasse 45, 8001 Zürich",
  },
  {
    title: "Internal Auditor",
    company: "Cargolane",
    city: "hamburg",
    remote: "hybrid",
    sal: [55000, 68000, "EUR"],
    source: "StepStone",
    status: "applied",
    score: 77,
    family: "Risk & Audit",
    h: 118,
    critic: [7, "PASS"],
    jd: "Cargolane is a logistics and freight-forwarding company operating across Northern Europe. The Internal Auditor will run operational and financial audits across group entities, assess internal control effectiveness, and report findings directly to the Audit Committee.",
    jdFull:
      "Cargolane moves freight across Northern Europe for manufacturing and retail clients, operating a network of warehouses and transport partners in six countries. As we grow, our Internal Audit function needs an additional pair of hands.\n\nThe Role\nYou will plan and execute operational and financial audits across group entities, assess the design and effectiveness of internal controls, and report findings and recommendations to the Audit Committee. You'll work independently but coordinate closely with the Head of Internal Audit.\n\nWhat you'll do\n- Plan and execute risk-based internal audits across warehouse and finance operations\n- Test internal controls and document findings in line with IIA standards\n- Draft audit reports and present recommendations to management\n- Follow up on remediation of prior audit findings\n- Support fraud risk assessments where required\n\nWhat we offer\n- Hybrid working from our Hamburg office, flexible on days\n- Exposure to operations across six European countries\n- Structured path towards Senior Internal Auditor\n- Company car allowance for site visits\n\nWe're looking for someone rigorous, independent-minded and comfortable travelling occasionally to our warehouse sites.",
    req: [
      "3+ years internal or external audit experience",
      "Knowledge of internal control frameworks (COSO or similar)",
      "Comfortable with occasional travel to warehouse sites",
      "German and English fluency",
      "Experience in logistics or manufacturing a plus",
    ],
    pros: [
      "Esposizione a operazioni multi-paese",
      "Percorso verso Senior Internal Auditor",
    ],
    cons: [
      "Trasferte occasionali verso i siti di magazzino",
      "Tedesco richiesto, competenza da verificare nel candidato",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: German + English\n\nRuolo di Internal Auditor in azienda di logistica multi-paese, in linea con l'esperienza di audit del candidato ma su un settore (logistics/warehouse) meno familiare rispetto al background prevalentemente tech. Il tedesco richiesto è un vincolo reale da verificare.\nNOTE_MISMATCH: [LANGUAGE] Tedesco richiesto come lingua di lavoro, il candidato dichiara solo inglese fluente.",
    scoreNotes:
      "Punteggio medio-alto: solide basi di audit e controlli interni, ma il settore logistico e il requisito di tedesco riducono il fit rispetto al profilo prevalentemente tech del candidato.",
    criticNotes:
      "Round 1: 6/10, Round 2: 7/10, Round 3: 7/10. Verdict: PASS. Strength: metodologia di audit e controlli interni ben documentati nel CV. Gap: nessuna esperienza pregressa nel settore logistico, il CV non la rivendica e resta su settori adiacenti.",
  },
  {
    title: "Finance Business Partner",
    company: "Brightline",
    city: "london",
    remote: "hybrid",
    sal: [60000, 75000, "GBP"],
    source: "Otta",
    status: "response",
    score: 79,
    family: "FP&A",
    h: 172,
    critic: [7, "PASS"],
    jd: "Brightline is a consumer subscription business scaling across the UK and EU. The Finance Business Partner will sit alongside the Marketing and Growth teams, owning budget tracking, campaign ROI analysis and monthly business reviews.",
    jdFull:
      "Brightline builds subscription products for busy consumers, from meal planning to fitness. We've grown revenue 3x in two years and are investing further in Marketing and Growth — which is why we need a Finance Business Partner embedded in those teams.\n\nThe Role\nYou will partner directly with Marketing and Growth leadership, owning their budget tracking, campaign ROI analysis and monthly business reviews. You'll translate finance data into decisions the team can act on, not just reports.\n\nWhat you'll do\n- Own budget tracking and variance analysis for Marketing and Growth\n- Build and maintain CAC/LTV and campaign ROI models\n- Lead monthly business review meetings with department heads\n- Partner with FP&A on the quarterly forecast for growth spend\n- Identify efficiency opportunities across paid acquisition channels\n\nWhat we offer\n- Competitive salary with performance bonus\n- Hybrid working from our London office, 2 days on site\n- Direct partnership with senior Marketing and Growth leaders\n- Wellness stipend and enhanced parental leave\n\nWe want someone who enjoys translating numbers into a story the business can act on.",
    req: [
      "3+ years FP&A or finance business partnering experience",
      "CAC/LTV and marketing ROI modelling experience",
      "Strong Excel/Sheets and BI tooling skills",
      "Confident presenting to non-finance stakeholders",
      "Experience in subscription or consumer business a plus",
    ],
    pros: [
      "Ruolo di forte partnership con Marketing e Growth",
      "Modelli CAC/LTV in linea con esperienza del candidato",
    ],
    cons: [
      "Focus quasi esclusivo su marketing spend, minore varietà rispetto a FP&A generalista",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo di Finance Business Partner focalizzato su Marketing e Growth in un business in abbonamento, in linea con l'esperienza di modellazione CAC/LTV del candidato. Il contesto UK con ibrido leggero (2 giorni) è compatibile con il profilo.\nNOTE_MISMATCH: [DOMAIN] Focus fortemente marketing-centrico, il candidato ha background FP&A più generalista.",
    scoreNotes:
      "Punteggio buono: modellazione CAC/LTV e business partnering ben coperti, il focus quasi esclusivo su marketing riduce leggermente la varietà rispetto al profilo generalista del candidato.",
    criticNotes:
      "Round 1: 7/10, Round 2: 7/10, Round 3: 7/10. Verdict: PASS. Strength: modelli di ROI marketing e business partnering documentati con esempi concreti. Gap: esperienza specifica in business in abbonamento limitata, CV non la rivendica direttamente.",
    addr: "24 Old Street, London EC1V 9AB",
  },
  {
    title: "M&A Analyst",
    company: "Portico Advisors",
    city: "lisbon",
    remote: "hybrid",
    sal: [45000, 60000, "EUR"],
    source: "eFinancialCareers",
    status: "writing",
    score: 85,
    family: "M&A / Deals",
    h: 34,
    wr: true,
    jd: "Portico Advisors is a boutique M&A advisory firm focused on mid-market transactions across Southern Europe. As M&A Analyst you'll support valuation work, due diligence and deal execution across live transactions, working closely with senior deal leads in a small, high-intensity team.",
    jdFull:
      "Portico Advisors advises founders and PE sponsors on mid-market M&A transactions across Portugal, Spain and Italy. Deal sizes typically range from €10m to €150m, and our small team runs lean on every mandate.\n\nThe Role\nYou will support valuation modelling, due diligence coordination and deal execution across live transactions, working directly with Directors and Partners on every deal from pitch to close. This is a hands-on role with real deal exposure from day one.\n\nWhat you'll do\n- Build DCF, comparable company and precedent transaction valuations\n- Coordinate due diligence workstreams with legal, tax and commercial advisors\n- Prepare information memoranda and management presentation materials\n- Support negotiation prep and deal structuring discussions\n- Maintain deal trackers and investor communication materials\n\nWhat we offer\n- Competitive base salary plus deal bonus\n- Hybrid working from our Lisbon office, flexible around deal deadlines\n- Direct mentorship from Partners on every live transaction\n- Fast track towards Associate within 2-3 years for strong performers\n\nExpect intense periods around deal closings, balanced by flexibility between mandates.",
    req: [
      "1-3 years in M&A, investment banking or transaction advisory",
      "Strong DCF and comparable company valuation skills",
      "Advanced Excel and PowerPoint",
      "Portuguese or Spanish a plus, English mandatory",
      "Comfortable with high-intensity deal periods",
    ],
    pros: [
      "Esposizione diretta a deal reali dal primo giorno",
      "Percorso rapido verso Associate",
      "Mentorship diretta da Partner",
    ],
    cons: [
      "Ritmi intensi nei periodi di chiusura deal",
      "Portoghese/spagnolo utile ma non posseduto",
    ],
    notes:
      "SENIORITY_JD: junior\nEXPERIENCE_REQUIRED: 1-3 years\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: English, Portuguese/Spanish a plus\n\nRuolo di M&A Analyst in boutique advisory portoghese, con forte enfasi su valuation e due diligence in linea con il profilo del candidato in ambito deal advisory. Il team piccolo garantisce esposizione diretta ma implica ritmi intensi nei periodi di chiusura.\nNOTE_MISMATCH: [LANGUAGE] Portoghese/spagnolo indicati come plus, il candidato ha solo inglese fluente.",
    scoreNotes:
      "Punteggio alto: competenze di valuation e M&A ben allineate, il gap linguistico su portoghese/spagnolo è marginale trattandosi di requisito preferenziale.",
  },
  {
    title: "Revenue Operations Analyst",
    company: "Pipebase",
    remote: "full_remote",
    sal: [50000, 64000, "EUR"],
    source: "Company site",
    status: "writing",
    score: 74,
    family: "Business Analysis",
    h: 48,
    wr: true,
    jd: "Pipebase builds sales pipeline analytics tools for B2B SaaS companies. The Revenue Operations Analyst will own CRM data hygiene, pipeline reporting and sales forecasting accuracy, working fully remote across a distributed European team.",
    jdFull:
      "Pipebase helps B2B SaaS sales teams turn messy CRM data into pipeline they can actually trust. We're a fully remote team of 22 spread across Europe, and we're hiring a Revenue Operations Analyst to keep our own numbers honest.\n\nThe Role\nYou will own CRM data hygiene, build and maintain pipeline reporting dashboards, and improve the accuracy of our sales forecasting process. You'll work closely with Sales leadership and our data team to make sure every number tells the truth.\n\nWhat you'll do\n- Maintain CRM data quality and enforce data entry standards across the sales team\n- Build and maintain pipeline and forecast dashboards in our BI tool\n- Support the weekly forecast call with data-backed insights\n- Identify process gaps and propose RevOps automation improvements\n- Partner with Sales and Marketing on lead-to-revenue funnel analysis\n\nWhat we offer\n- Fully remote, work from anywhere in Europe\n- Flexible hours, async-first culture with core overlap hours\n- Annual team offsite (last year: Lisbon)\n- Home office stipend\n\nWe're looking for someone who's obsessive about clean data and comfortable pushing back on sales reps who skip fields.",
    req: [
      "2+ years in RevOps, Sales Ops or Business Analysis",
      "Advanced CRM administration (Salesforce or HubSpot)",
      "SQL and dashboarding (Looker/Tableau) experience",
      "Comfortable working fully async across time zones",
      "English fluency required",
    ],
    pros: [
      "Full remote reale, nessun vincolo geografico",
      "Ruolo dati/CRM in linea con esperienza analitica del candidato",
    ],
    cons: ["Cultura fortemente async, richiede autonomia elevata"],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo RevOps full remote in una scale-up SaaS, in linea con l'esperienza del candidato su CRM e reporting pipeline. La cultura async richiede forte autonomia, aspetto da verificare in colloquio ma non bloccante sulla carta.\nNOTE_MISMATCH: [STACK] Richiesta amministrazione avanzata Salesforce/HubSpot, il candidato ha esperienza solo base su CRM.",
    scoreNotes:
      "Punteggio medio-alto: competenze SQL e reporting ben coperte, gap sulla profondità di amministrazione CRM che è centrale nel ruolo.",
  },
  {
    title: "Group Reporting Specialist",
    company: "Nordwind",
    city: "stockholm",
    remote: "hybrid",
    sal: [52000, 64000, "EUR"],
    source: "LinkedIn",
    status: "review",
    score: 78,
    family: "Accounting",
    h: 56,
    jd: "Nordwind is a Nordic renewable energy group consolidating financial results across 12 subsidiaries. The Group Reporting Specialist will own monthly and quarterly group consolidation, IFRS reporting and support the annual report process.",
    jdFull:
      "Nordwind develops and operates wind and solar assets across the Nordics, with 12 operating subsidiaries and growing. Our Group Reporting team needs an experienced specialist to keep consolidation running smoothly as we add new entities.\n\nThe Role\nYou will own monthly and quarterly group consolidation, ensure compliance with IFRS reporting standards, and support the preparation of the annual report. You'll work closely with local finance teams across Sweden, Norway and Denmark.\n\nWhat you'll do\n- Run monthly and quarterly consolidation across 12+ subsidiaries\n- Ensure IFRS compliance across group reporting\n- Support statutory annual report preparation and audit liaison\n- Maintain intercompany reconciliation processes\n- Improve consolidation tooling (currently a mix of Excel and Cognos)\n\nWhat we offer\n- Hybrid working from our Stockholm office, 2-3 days on site\n- Exposure to a fast-growing renewable energy portfolio\n- Collaborative Nordic work culture with strong work-life balance\n- Pension and health insurance above statutory minimum\n\nWe're looking for someone who's meticulous, deadline-driven and comfortable working across multiple entities and currencies.",
    req: [
      "3-5 years group consolidation or reporting experience",
      "Strong IFRS knowledge",
      "Experience with consolidation tools (Cognos, HFM or similar)",
      "Comfortable working across multiple currencies and entities",
      "English required, Swedish a plus",
    ],
    pros: [
      "Consolidamento multi-entità in linea con esperienza pregressa",
      "Settore rinnovabili in crescita, buona stabilità",
    ],
    cons: [
      "Tooling di consolidamento ancora parzialmente su Excel, processo da modernizzare",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3-5 years\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: English, Swedish a plus\n\nRuolo di Group Reporting Specialist in gruppo energetico nordico con consolidamento multi-entità, coerente con l'esperienza IFRS del candidato. Il tooling ancora ibrido Excel/Cognos richiede tolleranza a processi non completamente automatizzati.\nNOTE_MISMATCH: [STACK] Cognos/HFM richiesti come tool di consolidamento, il candidato ha esperienza solo su Excel avanzato.",
    scoreNotes:
      "Punteggio buono: solida base IFRS e consolidamento, gap specifico sul tool di consolidamento (Cognos) mai usato direttamente dal candidato.",
    addr: "Kungsgatan 12, 111 43 Stockholm",
  },
  {
    title: "Pricing Analyst",
    company: "Loopway",
    city: "barcelona",
    remote: "full_remote",
    sal: [45000, 58000, "EUR"],
    source: "Wellfound",
    status: "review",
    score: 80,
    family: "Business Analysis",
    h: 64,
    jd: "Loopway is a B2B marketplace connecting European manufacturers with industrial buyers. The Pricing Analyst will own dynamic pricing models, margin analysis and competitor price monitoring, working fully remote within a small commercial analytics team.",
    jdFull:
      "Loopway operates a B2B marketplace where industrial buyers source components directly from European manufacturers. Pricing is our biggest lever for margin, and we're hiring a Pricing Analyst to help us get it right.\n\nThe Role\nYou will own our dynamic pricing models, run margin analysis across product categories, and monitor competitor pricing to inform strategy. You'll work closely with the Commercial and Data teams, fully remote.\n\nWhat you'll do\n- Build and maintain dynamic pricing models by product category\n- Run margin and elasticity analysis to inform pricing strategy\n- Monitor competitor pricing and market trends\n- Partner with Commercial team on customer-specific pricing requests\n- Present pricing recommendations to the leadership team\n\nWhat we offer\n- Fully remote within the EU\n- Flexible hours with quarterly in-person team gatherings\n- Direct impact on a core lever of company profitability\n- Learning budget for pricing/analytics certifications\n\nWe want someone curious about numbers who can turn pricing data into a clear recommendation.",
    req: [
      "2+ years in pricing, revenue management or business analysis",
      "Strong Excel/SQL skills, Python a plus",
      "Experience with elasticity or margin analysis",
      "Comfortable presenting recommendations to leadership",
      "English fluency, Spanish a plus",
    ],
    pros: [
      "Full remote reale nell'UE",
      "Ruolo con impatto diretto su marginalità, in linea con profilo analitico",
    ],
    cons: ["Team piccolo, poco supporto strutturato su pricing avanzato"],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English, Spanish a plus\n\nRuolo di Pricing Analyst full remote in marketplace B2B, in linea con le competenze di analisi margine e SQL del candidato. Il team piccolo implica meno struttura ma anche più autonomia decisionale sul pricing.\nNOTE_MISMATCH: [STACK] Python indicato come plus, il candidato lo padroneggia solo a livello base.",
    scoreNotes:
      "Punteggio buono: analisi di margine e SQL centrati, il Python resta un plus non posseduto a livello avanzato dal candidato.",
  },
  {
    title: "Junior Accountant",
    company: "Weblab Italia",
    city: "bologna",
    remote: "onsite",
    sal: [26000, 32000, "EUR"],
    source: "Indeed",
    status: "scored",
    score: 54,
    family: "Accounting",
    h: 74,
    jd: "Weblab Italia is a small web agency serving local SMEs across Emilia-Romagna. The Junior Accountant will support day-to-day bookkeeping, invoice processing and VAT filings under the guidance of an external commercialista, working fully on site in Bologna.",
    jdFull:
      "Weblab Italia builds websites and e-commerce platforms for small and medium businesses across Emilia-Romagna. We're a small team of 15 and need a Junior Accountant to support our day-to-day finance operations.\n\nThe Role\nYou will support bookkeeping, process supplier and customer invoices, and assist with VAT filings under the supervision of our external commercialista. This is a hands-on, entry-level role ideal for someone early in their accounting career.\n\nWhat you'll do\n- Process supplier and customer invoices in our accounting software\n- Support monthly VAT registers and periodic filings\n- Reconcile bank statements and petty cash\n- Assist with payroll data collection for the external payroll provider\n- Support the annual closing process alongside the commercialista\n\nWhat we offer\n- On-site role at our Bologna office, standard office hours\n- Structured on-the-job training in Italian accounting practice\n- Small team, direct contact with the founder\n- Meal vouchers\n\nIdeal for a recent graduate or early-career professional looking to build a solid accounting foundation.",
    req: [
      "0-2 years accounting or bookkeeping experience",
      "Familiarity with Italian invoicing and VAT basics",
      "Comfortable with Excel",
      "Diploma in Ragioneria or equivalent degree",
      "Italian native, basic English a plus",
    ],
    pros: ["Buon punto di ingresso per formazione contabile strutturata"],
    cons: [
      "Ruolo junior con mansioni ripetitive, poco spazio di analisi",
      "Retribuzione bassa rispetto al mercato",
    ],
    notes:
      "SENIORITY_JD: junior\nEXPERIENCE_REQUIRED: 0-2 anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred, diploma ragioneria\nLANGUAGE_REQUIRED: Italian\n\nRuolo entry-level di contabilità in piccola web agency bolognese, con mansioni operative di base (fatture, IVA, riconciliazioni). Il profilo del candidato è più senior rispetto al livello richiesto, ruolo probabilmente sotto le sue capacità analitiche.\nNOTE_MISMATCH: [SENIORITY] Ruolo junior con mansioni base, il candidato ha esperienza superiore a quanto richiesto.",
    scoreNotes:
      "Punteggio basso-medio: il ruolo è junior e operativo, sotto il livello di seniority e le aspirazioni analitiche del candidato, anche se lo stipendio e le mansioni sono coerenti con l'annuncio.",
  },
  {
    title: "Credit Controller",
    company: "MarketNest",
    city: "roma",
    remote: "hybrid",
    sal: [30000, 38000, "EUR"],
    source: "Indeed",
    status: "scored",
    score: 58,
    family: "Accounting",
    h: 88,
    jd: "MarketNest is an online marketplace for home services operating across Italy. The Credit Controller will manage accounts receivable, chase overdue payments from business customers, and support cash collection targets for the finance team.",
    jdFull:
      "MarketNest connects homeowners with vetted service professionals across Italy, processing thousands of transactions monthly. Our AR book has grown alongside the business, and we need a Credit Controller to keep collections on track.\n\nThe Role\nYou will manage the accounts receivable ledger, chase overdue payments from business customers, and work towards monthly cash collection targets. You'll report to the Finance Manager and coordinate with Sales on problematic accounts.\n\nWhat you'll do\n- Manage AR ledger and monitor overdue balances\n- Chase payments via phone and email, escalating where needed\n- Reconcile customer accounts and resolve billing disputes\n- Report on DSO and collection KPIs monthly\n- Coordinate with Sales on at-risk accounts\n\nWhat we offer\n- Hybrid working from our Rome office, 3 days on site\n- Structured onboarding and monthly collection targets with bonus\n- Small, supportive finance team\n- Meal vouchers and transport allowance\n\nWe're looking for someone persistent, organized, and comfortable with difficult payment conversations.",
    req: [
      "2+ years in credit control or accounts receivable",
      "Comfortable with collection calls and dispute resolution",
      "Experience with ERP/accounting software",
      "Italian native, basic English a plus",
      "Target-driven mindset",
    ],
    pros: ["Ruolo con obiettivi chiari e bonus collegato ai risultati"],
    cons: [
      "Attività ripetitiva di recupero crediti, poco spazio analitico",
      "Stipendio sotto la media per il livello di esperienza del candidato",
    ],
    notes:
      "SENIORITY_JD: junior\nEXPERIENCE_REQUIRED: 2+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Italian\n\nRuolo di Credit Controller in marketplace italiano, mansioni operative di recupero crediti che valorizzano solo parzialmente le competenze analitiche del candidato. Contesto stabile ma con margini di crescita limitati nel breve periodo.\nNOTE_MISMATCH: [SALARY] Fascia salariale sotto le aspettative dichiarate dal candidato per il livello di esperienza.",
    scoreNotes:
      "Punteggio medio-basso: ruolo operativo di recupero crediti poco allineato al profilo più analitico del candidato, con stipendio sotto le aspettative dichiarate.",
    addr: "Via del Corso 154, 00186 Roma",
  },
  {
    title: "FP&A Analyst",
    company: "Lexio AI",
    city: "munich",
    remote: "hybrid",
    sal: [55000, 68000, "EUR"],
    source: "LinkedIn",
    status: "scored",
    score: 72,
    family: "FP&A",
    h: 100,
    jd: "Lexio AI is a German AI startup building enterprise document automation tools. The FP&A Analyst will support the monthly forecast cycle, build headcount and burn-rate models, and prepare investor reporting materials for the Series A round.",
    jdFull:
      "Lexio AI builds AI-powered document automation for enterprise legal and compliance teams. Having just closed our Series A, we're building out finance from scratch and need an FP&A Analyst to bring structure to our planning.\n\nThe Role\nYou will support the monthly forecast cycle, build headcount and burn-rate models, and prepare investor reporting materials. You'll work directly with the founders in a small, fast-moving team.\n\nWhat you'll do\n- Build and maintain the monthly forecast and burn-rate model\n- Track headcount planning against budget\n- Prepare investor reporting packs and board materials\n- Support fundraising data room preparation\n- Help set up scalable FP&A processes from an early base\n\nWhat we offer\n- Competitive salary plus meaningful equity\n- Hybrid working from our Munich office, flexible on days\n- Direct access to founders and early-stage decision making\n- Fast-paced, high-ownership environment\n\nWe're looking for someone comfortable building process where none exists yet.",
    req: [
      "2-4 years FP&A or startup finance experience",
      "Strong Excel/Sheets modelling skills",
      "Experience with burn-rate and runway modelling",
      "Comfortable working directly with founders",
      "German a plus, English mandatory",
    ],
    pros: [
      "Esposizione diretta ai founder",
      "Costruzione processi FP&A da zero, buona palestra",
    ],
    cons: [
      "Startup early-stage, minore stabilità rispetto a scale-up più mature",
      "Tedesco utile ma non posseduto",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2-4 years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English, German a plus\n\nRuolo FP&A in startup AI early-stage a Monaco, in linea con l'esperienza di modellazione del candidato ma su una realtà più giovane e meno strutturata rispetto ai precedenti ruoli in scale-up. Buona opportunità di costruire processi da zero.\nNOTE_MISMATCH: [SENIORITY] Contesto early-stage con processi FP&A ancora da costruire, richiede più flessibilità rispetto a ruoli in aziende già strutturate.",
    scoreNotes:
      "Punteggio medio: buon allineamento sulle competenze di modellazione, ma la fase early-stage e la minore struttura del team riducono il punteggio rispetto a ruoli in aziende più mature.",
  },
  {
    title: "Data Analyst, Finance",
    company: "Fluxwave",
    remote: "full_remote",
    sal: [48000, 62000, "EUR"],
    source: "LinkedIn",
    status: "scored",
    score: 70,
    family: "Business Analysis",
    h: 108,
    jd: "Fluxwave is a remote-first data infrastructure company serving mid-market SaaS clients. The Data Analyst, Finance will build financial dashboards, automate recurring reporting, and support ad hoc analysis for the finance and operations teams.",
    jdFull:
      "Fluxwave provides data pipeline infrastructure for mid-market SaaS companies, fully remote since founding. Our finance team relies heavily on data, and we're hiring a Data Analyst to help us report faster and more accurately.\n\nThe Role\nYou will build and maintain financial dashboards, automate recurring reporting tasks, and support ad hoc analysis requested by Finance and Operations leadership. You'll work with SQL and our internal BI stack daily.\n\nWhat you'll do\n- Build and maintain financial dashboards in our BI tool (Metabase)\n- Automate recurring reporting tasks using SQL and Python scripts\n- Support ad hoc analysis requests from Finance and Ops\n- Maintain data quality checks on financial data pipelines\n- Document reporting logic for cross-team transparency\n\nWhat we offer\n- Fully remote, flexible hours with core overlap\n- Small, senior team with high technical bar\n- Annual learning stipend\n- Home office equipment budget\n\nWe're looking for someone who enjoys turning messy data into dashboards people actually trust.",
    req: [
      "2+ years in data/financial analysis",
      "Strong SQL skills, Python a plus",
      "Experience with BI tools (Metabase, Looker or similar)",
      "Comfortable working fully remote and async",
      "English fluency required",
    ],
    pros: [
      "Ruolo full remote con forte enfasi SQL, in linea col profilo",
      "Team tecnico senior, buona palestra",
    ],
    cons: [
      "Automazione reporting via Python richiesta più a fondo di quanto il candidato padroneggi",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo di Data Analyst finance-oriented in azienda dati full remote, buon allineamento sul lato SQL/BI del profilo del candidato. La componente di automazione via Python è più richiesta di quanto il candidato attualmente padroneggi.\nNOTE_MISMATCH: [STACK] Python per automazione reporting richiesto in modo più strutturato di quanto il candidato dichiari nel CV.",
    scoreNotes:
      "Punteggio medio: SQL e dashboarding centrati, il gap sulla profondità di Python per l'automazione riduce il punteggio.",
  },
  {
    title: "Compliance Analyst, AML",
    company: "SignalForge",
    remote: "full_remote",
    sal: [55000, 72000, "USD"],
    source: "LinkedIn",
    status: "scored",
    score: 63,
    family: "Risk & Audit",
    h: 124,
    jd: "SignalForge is a US-based fintech offering embedded payments to marketplaces, operating fully remote across time zones. The Compliance Analyst, AML will monitor transaction alerts, support SAR filings, and maintain AML policy documentation.",
    jdFull:
      "SignalForge powers embedded payments for marketplace platforms across North America and Europe. As we scale transaction volume, our compliance function needs to scale with it.\n\nThe Role\nYou will monitor AML transaction alerts, support the filing of suspicious activity reports (SARs), and help maintain our AML policy documentation. You'll work within a distributed compliance team reporting to the Head of Compliance.\n\nWhat you'll do\n- Review and disposition AML transaction monitoring alerts\n- Support SAR filing and documentation in line with US and EU requirements\n- Maintain and update AML policies and procedures\n- Support periodic risk assessments and regulatory exams\n- Escalate high-risk cases to senior compliance staff\n\nWhat we offer\n- Fully remote, US or EU based\n- Competitive compensation benchmarked to US fintech market\n- Structured compliance training and certification support (CAMS)\n- Async-friendly culture with reasonable overlap hours\n\nWe're looking for someone detail-oriented who takes financial crime prevention seriously.",
    req: [
      "2+ years AML/compliance experience in fintech or banking",
      "Familiarity with transaction monitoring systems",
      "Knowledge of US and/or EU AML regulatory frameworks",
      "CAMS certification a plus",
      "English fluency required, comfortable with US time zone overlap",
    ],
    pros: [
      "Compenso competitivo su benchmark USA",
      "Supporto per certificazione CAMS",
    ],
    cons: [
      "Overlap con fuso orario USA richiede orari serali per un candidato europeo",
      "Framework normativo USA meno familiare rispetto a quello europeo",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2+ years\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: English\n\nRuolo di Compliance Analyst AML in fintech USA-based, con esperienza di risk/audit del candidato solo parzialmente sovrapponibile al framework normativo statunitense. L'overlap di fuso orario è un vincolo pratico non trascurabile.\nNOTE_MISMATCH: [GEO] Overlap richiesto con fuso orario USA, comporta orari serali per un candidato basato in Europa.",
    scoreNotes:
      "Punteggio medio-basso: esperienza di compliance/risk presente ma il framework normativo USA e l'overlap orario con gli Stati Uniti riducono il fit pratico.",
  },
  {
    title: "Payroll Specialist",
    company: "Testardo",
    city: "torino",
    remote: "hybrid",
    sal: [28000, 35000, "EUR"],
    source: "Indeed",
    status: "scored",
    score: 56,
    family: "Accounting",
    h: 134,
    jd: "Testardo is an Italian manufacturing company with roughly 300 employees across two plants. The Payroll Specialist will process monthly payroll for both sites, manage employee data in the HR system, and liaise with the external payroll consultant.",
    jdFull:
      "Testardo manufactures precision mechanical components for the automotive supply chain, with two plants near Turin and around 300 employees. We're looking for a Payroll Specialist to join our small HR/Finance team.\n\nThe Role\nYou will process monthly payroll for both plants, maintain accurate employee data in our HR system, and act as the main point of contact with our external payroll consultant (consulente del lavoro). You'll also support HR on contract administration.\n\nWhat you'll do\n- Prepare and process monthly payroll data for ~300 employees\n- Maintain employee master data and contract records\n- Liaise with the external payroll consultant on calculations and compliance\n- Support onboarding/offboarding administrative processes\n- Handle employee queries on payslips and leave balances\n\nWhat we offer\n- Hybrid working from our Turin office, 3 days on site\n- Stable, established manufacturing company\n- Structured processes and clear escalation paths\n- Meal vouchers and company canteen\n\nIdeal for someone precise, discreet and comfortable with sensitive employee data.",
    req: [
      "2-4 years payroll or HR administration experience",
      "Familiarity with Italian payroll and labor law basics",
      "Experience liaising with external payroll consultants",
      "Discretion handling sensitive employee data",
      "Italian native, English not required",
    ],
    pros: ["Azienda stabile con processi consolidati"],
    cons: [
      "Ruolo puramente payroll/HR admin, distante dal profilo finance/analytics del candidato",
      "Nessun requisito di inglese, poco internazionale",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2-4 anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Italian\n\nRuolo di Payroll Specialist in azienda manifatturiera torinese, mansioni di amministrazione del personale distanti dal profilo finance/analytics del candidato. Il fit è debole sia per contenuto del ruolo che per assenza di componente internazionale.\nNOTE_MISMATCH: [DOMAIN] Ruolo payroll/HR admin puro, il candidato ha profilo orientato a finance analitica non a gestione del personale.",
    scoreNotes:
      "Punteggio basso-medio: le competenze richieste (payroll, HR admin) sono distanti dal profilo analitico-finanziario del candidato, nonostante la stabilità dell'azienda.",
    addr: "Via Roma 88, 10121 Torino",
  },
  {
    title: "Investor Relations Associate",
    company: "GreenGrid",
    city: "amsterdam",
    remote: "hybrid",
    sal: [55000, 70000, "EUR"],
    source: "Otta",
    status: "scored",
    score: 68,
    family: "M&A / Deals",
    h: 144,
    jd: "GreenGrid is a renewable energy infrastructure fund manager based in Amsterdam. The Investor Relations Associate will support LP reporting, fundraising materials and due diligence requests, working closely with the IR Director.",
    jdFull:
      "GreenGrid manages a portfolio of renewable energy infrastructure assets across Europe on behalf of institutional investors. Our Investor Relations team is growing to support an upcoming fundraise.\n\nThe Role\nYou will support LP quarterly reporting, prepare fundraising materials, and respond to due diligence questionnaires from prospective investors. You'll work closely with the IR Director and the wider fund management team.\n\nWhat you'll do\n- Prepare quarterly LP reports and capital account statements\n- Support fundraising materials, including data room management\n- Respond to investor due diligence questionnaires (DDQs)\n- Coordinate investor meetings and annual general meetings\n- Track LP communications and maintain the CRM\n\nWhat we offer\n- Hybrid working from our Amsterdam office, 3 days on site\n- Exposure to institutional fundraising and infrastructure investing\n- Structured mentorship from the IR Director\n- Pension contribution above Dutch statutory minimum\n\nWe're looking for someone precise, discreet, and comfortable working with institutional investors.",
    req: [
      "2-3 years in investor relations, fund finance or fundraising support",
      "Experience preparing LP reporting or fund materials",
      "Strong PowerPoint and Excel skills",
      "Familiarity with fund structures a plus",
      "English fluency, Dutch a plus",
    ],
    pros: [
      "Esposizione a fundraising istituzionale e settore infrastrutture rinnovabili",
      "Ruolo strutturato con mentorship diretta",
    ],
    cons: ["Esperienza specifica in fund finance del candidato limitata"],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2-3 years\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: English, Dutch a plus\n\nRuolo di Investor Relations in fund manager di infrastrutture rinnovabili, settore adiacente ma non identico al background del candidato in FP&A/reporting. Buona opportunità di diversificazione verso il mondo dei fondi istituzionali.\nNOTE_MISMATCH: [DOMAIN] Esperienza specifica in fund finance/LP reporting limitata nel CV del candidato, ruolo in un dominio adiacente.",
    scoreNotes:
      "Punteggio medio: solide competenze di reporting trasferibili, ma l'esperienza specifica in investor relations e fund finance è limitata nel profilo del candidato.",
  },
  {
    title: "Junior Business Controller",
    company: "Ostrava Tech",
    city: "prague",
    remote: "hybrid",
    sal: [30000, 40000, "EUR"],
    source: "Company site",
    status: "checked",
    family: "FP&A",
    h: 154,
    jd: "Ostrava Tech is a Czech industrial software company serving manufacturing clients across Central Europe. The Junior Business Controller will support budgeting, variance analysis and cost center reporting under the guidance of the Business Controlling Manager.",
    jdFull:
      "Ostrava Tech builds MES and production planning software for manufacturers across Czechia, Poland and Slovakia. Our controlling team is growing and we're looking for a Junior Business Controller to join.\n\nThe Role\nYou will support the annual budgeting process, prepare variance analysis against plan, and maintain cost center reporting for department heads. You'll work under the guidance of the Business Controlling Manager, with exposure to the full controlling cycle.\n\nWhat you'll do\n- Support annual budgeting and quarterly reforecast cycles\n- Prepare monthly variance analysis by cost center\n- Maintain and improve cost center reporting templates\n- Assist with ad hoc analysis for department heads\n- Support the Controlling Manager on process documentation\n\nWhat we offer\n- Hybrid working from our Prague office, 3 days on site\n- Structured mentorship within a growing controlling team\n- Clear progression path to Business Controller within 2 years\n- Language courses subsidy (Czech/English)\n\nGreat entry point for someone early in their controlling career looking to build a strong foundation.",
    req: [
      "1-2 years in controlling, FP&A or accounting",
      "Strong Excel skills",
      "Analytical mindset and attention to detail",
      "English required, Czech a plus",
      "Degree in finance, economics or related field",
    ],
    notes:
      "SENIORITY_JD: junior\nEXPERIENCE_REQUIRED: 1-2 years\nEXPERIENCE_TYPE: mandatory\nDEGREE: required\nLANGUAGE_REQUIRED: English, Czech a plus\n\nRuolo junior di Business Controller in software house industriale ceca, buon punto di ingresso strutturato con percorso di crescita chiaro verso Business Controller. Il livello junior è leggermente sotto l'esperienza attuale del candidato.\nNOTE_MISMATCH: [SENIORITY] Ruolo junior con mansioni di supporto, il candidato ha già esperienza di controlling più autonoma.",
    addr: "Václavské náměstí 21, 110 00 Praha",
  },
  {
    title: "Head of Finance",
    company: "Snapdeck",
    city: "copenhagen",
    remote: "hybrid",
    sal: [85000, 105000, "EUR"],
    source: "Otta",
    status: "checked",
    family: "FP&A",
    h: 160,
    jd: "Snapdeck is a Danish e-commerce logistics platform scaling across the Nordics. The Head of Finance will build and lead the finance function, owning FP&A, accounting and treasury as the company prepares for a Series B raise.",
    jdFull:
      "Snapdeck operates last-mile delivery infrastructure for e-commerce retailers across Denmark, Sweden and Norway. Having recently closed our Series A, we're looking for a Head of Finance to build the function as we scale toward Series B.\n\nThe Role\nYou will lead all aspects of finance: FP&A, accounting, treasury and investor reporting. You'll build the team as we grow, currently supported by an outsourced bookkeeping partner, and report directly to the CEO.\n\nWhat you'll do\n- Own the finance function end to end: FP&A, accounting, treasury\n- Lead the Series B fundraising process from a finance perspective\n- Build and lead a growing finance team (currently 1 direct report)\n- Prepare board reporting and investor updates\n- Establish scalable financial processes and controls\n\nWhat we offer\n- Competitive salary plus meaningful equity\n- Hybrid working from our Copenhagen office, flexible on days\n- Direct reporting line to the CEO and a seat at the leadership table\n- Real ownership over building the finance function from the ground up\n\nWe're looking for a hands-on finance leader who has scaled a function before and wants to do it again.",
    req: [
      "6+ years finance experience with 2+ years in a leadership role",
      "Experience building a finance function in a scale-up",
      "Fundraising or investor reporting experience",
      "Strong stakeholder management with CEO/board",
      "English required, Danish a plus",
    ],
    notes:
      "SENIORITY_JD: lead\nEXPERIENCE_REQUIRED: 6+ years, 2+ in leadership\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: English, Danish a plus\n\nRuolo di Head of Finance in scale-up logistica danese, con richiesta di seniority di leadership superiore all'attuale esperienza del candidato. Opportunità interessante ma con un salto di livello significativo rispetto al percorso finora seguito.\nNOTE_MISMATCH: [SENIORITY] Richiesta esperienza di leadership 2+ anni, il candidato non ha ancora ricoperto ruoli di people management diretto.",
    addr: "Store Kongensgade 40, 1264 København",
  },
  {
    title: "Fund Accountant",
    company: "Dublin Fund Services",
    city: "dublin",
    remote: "hybrid",
    sal: [45000, 55000, "EUR"],
    source: "eFinancialCareers",
    status: "checked",
    family: "Accounting",
    h: 168,
    jd: "Dublin Fund Services provides fund administration for European private equity and real estate funds. The Fund Accountant will prepare NAV calculations, investor capital statements and quarterly financial reporting for a portfolio of client funds.",
    jdFull:
      "Dublin Fund Services administers private equity and real estate funds for European sponsors, managing NAV calculation and investor reporting for a growing client portfolio. We're hiring a Fund Accountant to join our expanding team.\n\nThe Role\nYou will prepare NAV calculations, investor capital account statements and quarterly financial reporting for a portfolio of client funds. You'll work under the guidance of a Fund Accounting Manager with exposure to multiple fund structures.\n\nWhat you'll do\n- Prepare NAV calculations and capital account statements for client funds\n- Support quarterly and annual financial reporting for fund clients\n- Process capital calls and distributions\n- Liaise with fund administrators, auditors and clients\n- Support onboarding of new fund clients onto our systems\n\nWhat we offer\n- Hybrid working from our Dublin 2 office, 3 days on site\n- Structured career path within fund administration (ACCA/ACA support)\n- Exposure to a variety of PE and real estate fund structures\n- Study support for professional qualifications\n\nWe're looking for someone detail-oriented with a genuine interest in fund structures and private markets.",
    req: [
      "2-3 years fund accounting or fund administration experience",
      "Understanding of NAV calculation and capital call processes",
      "Experience with fund accounting systems (Investran, eFront or similar)",
      "ACCA/ACA part-qualified a plus",
      "English fluency required",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2-3 years\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: English\n\nRuolo di Fund Accountant in fund administrator dublinese, settore adiacente ma distinto dal background del candidato in accounting corporate. Buona opportunità di specializzazione verso il mondo dei fondi privati.\nNOTE_MISMATCH: [DOMAIN] Nessuna esperienza pregressa in fund accounting/NAV nel CV del candidato, dominio nuovo rispetto all'accounting corporate.",
    addr: "1 Grand Canal Square, Dublin 2",
  },
  {
    title: "ESG Reporting Analyst",
    company: "Databridge",
    city: "madrid",
    remote: "hybrid",
    sal: [38000, 48000, "EUR"],
    source: "LinkedIn",
    status: "new",
    family: "Risk & Audit",
    h: 178,
    jdFull:
      "Databridge helps mid-cap companies prepare for CSRD and EU Taxonomy compliance, combining ESG data collection with reporting software. As regulatory deadlines approach, demand for our services is accelerating fast.\n\nThe Role\nAs ESG Reporting Analyst you will support clients in collecting ESG data, mapping it against CSRD/EU Taxonomy requirements, and preparing draft sustainability reports. You'll work within our advisory team, coordinating directly with client sustainability and finance teams.\n\nWhat you'll do\n- Collect and validate client ESG data across environmental, social and governance metrics\n- Map data against CSRD and EU Taxonomy reporting requirements\n- Draft sections of client sustainability reports\n- Support client workshops on data collection methodology\n- Track regulatory updates relevant to ESG reporting\n\nWhat we offer\n- Hybrid working from our Madrid office, 2-3 days on site\n- Fast-growing niche with strong long-term demand from EU regulation\n- Training support for sustainability reporting certifications\n- Collaborative team culture with regular knowledge-sharing sessions\n\nRequirements include analytical rigor, comfort with ambiguity in emerging regulation, and a genuine interest in sustainability topics. We are building a diverse team and welcome candidates from finance, sustainability or data backgrounds alike.",
  },
  {
    title: "Cost Accountant, Manufacturing",
    company: "Old Mill Industries",
    city: "firenze",
    remote: "onsite",
    sal: [32000, 40000, "EUR"],
    source: "Indeed",
    status: "new",
    family: "Accounting",
    h: 188,
    jdFull:
      "Old Mill Industries produces artisanal packaging materials for the food and beverage sector from its historic plant near Florence. As we modernize our cost accounting practices, we're looking for a Cost Accountant to join our finance team on site.\n\nThe Role\nYou will maintain standard costing for our production lines, analyze manufacturing variances, and support inventory valuation at month-end close. You'll work closely with the Plant Manager and report to the Finance Director.\n\nWhat you'll do\n- Maintain and update standard costs for raw materials and finished goods\n- Analyze production variances (price, usage, efficiency) monthly\n- Support month-end inventory valuation and reconciliation\n- Partner with Operations on cost reduction initiatives\n- Prepare cost reporting for management review\n\nWhat we offer\n- On-site role at our Florence plant, standard working hours\n- Stable, family-owned manufacturing business with decades of history\n- Structured training on standard costing methodology\n- Company canteen and transport allowance\n\nRequirements: prior manufacturing accounting experience is strongly preferred, along with comfort working on the plant floor alongside Operations. We value candidates who combine numerical precision with genuine curiosity about how things are made.",
    addr: "Via dei Calzaiuoli 9, 50122 Firenze",
  },
  {
    title: "Strategy Associate",
    company: "Kernelworks",
    remote: "full_remote",
    sal: [65000, 85000, "USD"],
    source: "Hacker News",
    status: "new",
    family: "Business Analysis",
    h: 194,
    jdFull:
      "Kernelworks builds developer tooling for distributed systems engineers, fully remote and profitable since day one. As we plan our next phase of growth, we're bringing on a Strategy Associate to support the founders directly.\n\nThe Role\nYou will support strategic planning, competitive analysis and go-to-market decisions directly with the founding team. This is a broad, high-ownership role for someone who wants exposure across the entire business rather than a narrow lane.\n\nWhat you'll do\n- Conduct market and competitive analysis to inform strategic decisions\n- Build financial and scenario models to evaluate new initiatives\n- Support go-to-market planning for new product lines\n- Prepare materials for founder-level strategic discussions\n- Take ownership of ad hoc special projects across the business\n\nWhat we offer\n- Fully remote, work from anywhere\n- Direct, daily access to the founding team\n- Competitive salary with meaningful equity\n- Flat structure with real influence on company direction\n\nRequirements: strong analytical and modelling skills, comfort with ambiguity, and genuine curiosity about developer tools and distributed systems. We're a small, profitable team that moves fast and values clear thinking over credentials.",
  },
  {
    title: "Door-to-door Insurance Agent",
    company: "AssicuraPlus",
    city: "roma",
    remote: "onsite",
    sal: [18000, 26000, "EUR"],
    source: "Indeed",
    status: "excluded",
    score: 20,
    family: "Sales",
    h: 204,
    jd: "AssicuraPlus is a local insurance agency network selling home and life policies door-to-door across Rome and its suburbs. The role involves canvassing residential areas, cold-calling leads and closing policies on a pure commission-heavy structure.",
    jdFull:
      "AssicuraPlus is expanding its door-to-door sales network across Rome and surrounding municipalities. We're looking for motivated agents to sell home and life insurance policies directly to residents.\n\nThe Role\nYou will canvass residential neighborhoods, cold-call leads from provided lists, and close insurance policies face to face. Compensation is primarily commission-based with a small fixed component.\n\nWhat you'll do\n- Canvass assigned residential areas door-to-door\n- Cold-call leads and book in-person appointments\n- Present and close home/life insurance policies\n- Maintain a pipeline of prospects in our CRM\n- Attend weekly sales training sessions\n\nWhat we offer\n- Small fixed base plus uncapped commission\n- Company-provided leads and sales materials\n- Ongoing sales training\n\nOpen to candidates without prior insurance experience, full training provided.",
    cons: [
      "Retribuzione quasi interamente a provvigione, nessuna base fissa adeguata",
      "Nessuna sovrapposizione con competenze finance del candidato",
    ],
    notes:
      "EXCLUDED: [DOMAIN] Ruolo di vendita porta a porta su commissione, incompatibile con il profilo finance/analytics del candidato e senza alcuna componente analitica.",
    scoreNotes:
      "Punteggio molto basso: ruolo di vendita diretta porta a porta, nessuna sovrapposizione con competenze finance/analytics, retribuzione quasi interamente a commissione.",
    addr: "Viale Marconi 210, 00146 Roma",
  },
  {
    title: "Data Entry Clerk, Invoices",
    company: "CallItalia",
    city: "napoli_x",
    remote: "onsite",
    sal: [19000, 23000, "EUR"],
    source: "Indeed",
    status: "excluded",
    score: 26,
    family: "Accounting",
    h: 214,
    jd: "CallItalia is a call center operator handling back-office invoice processing for utility companies. The Data Entry Clerk role involves manually inputting invoice data into a legacy system across full-day on-site shifts in Naples.",
    jdFull:
      "CallItalia provides outsourced back-office and call center services for utility and telecom companies across Southern Italy. We're hiring Data Entry Clerks to support our invoice processing team.\n\nThe Role\nYou will manually input invoice data into our legacy processing system, verify data accuracy against scanned documents, and flag discrepancies to the team lead. This is a high-volume, repetitive on-site role with fixed shifts.\n\nWhat you'll do\n- Enter invoice data manually into the internal system\n- Verify entries against scanned source documents\n- Flag discrepancies or missing data to the team lead\n- Meet daily entry volume targets\n- Maintain confidentiality of client data\n\nWhat we offer\n- Fixed shift schedule, on-site in Naples\n- Basic training provided, no prior experience required\n- Entry-level salary with meal vouchers\n\nNo prior finance or accounting background required, we provide full training on the system.",
    cons: [
      "Mansioni ripetitive di data entry manuale",
      "Nessuna prospettiva di crescita professionale",
    ],
    notes:
      "EXCLUDED: [SENIORITY] Ruolo di data entry puramente manuale e ripetitivo, ben al di sotto del livello di seniority e delle competenze analitiche del candidato.",
    scoreNotes:
      "Punteggio molto basso: mansioni di inserimento dati manuale senza alcuna componente analitica, salario base e nessuna prospettiva di crescita per il profilo del candidato.",
  },
  {
    title: "FP&A Analyst",
    company: "Vantora",
    city: "lyon",
    remote: "hybrid",
    sal: [42000, 52000, "EUR"],
    source: "LinkedIn",
    status: "new",
    family: "FP&A",
    h: 3,
    jdFull:
      "Vantora is a fast-growing subscription analytics platform serving mid-market retailers across France and the Benelux. We help finance teams turn messy transactional data into clean recurring-revenue forecasts, and we are scaling our own finance function to match the pace of the business.\n\nThe Role\nWe are hiring an FP&A Analyst to join our small but sharp finance team in Lyon. You will own the monthly forecast refresh, build variance analysis for department heads, and support the CFO in preparing the quarterly board deck. This is a hands-on role with real ownership from day one.\n\nWhat You'll Do\n- Maintain and improve the driver-based forecast model in Excel/Google Sheets\n- Partner with Sales and Customer Success on pipeline-to-revenue bridges\n- Prepare monthly management reporting packs with clear commentary\n- Support ad hoc analysis for pricing and cost initiatives\n- Help migrate reporting into our new BI stack (Looker)\n\nWhat We Offer\n- Hybrid setup, 3 days/week in our Lyon office (Part-Dieu)\n- Competitive salary plus company equity\n- 25 days holiday, meal vouchers, mutuelle\n- Direct exposure to the CFO and leadership team\n\nWe are looking for someone rigorous, curious and comfortable with ambiguity, this is a fast-moving environment where priorities shift with the business.",
    addr: "12 Rue de la République, 69002 Lyon",
  },
  {
    title: "Corporate Development Analyst",
    company: "Redshore Capital",
    city: "frankfurt",
    remote: "full_remote",
    source: "eFinancialCareers",
    status: "new",
    family: "M&A / Deals",
    h: 9,
    jdFull:
      "Redshore Capital is a pan-European investment platform backing growth-stage fintech and infrastructure companies. Our small corporate development team evaluates add-on acquisitions, minority investments and strategic partnerships across our portfolio.\n\nThe Role\nWe're looking for a Corporate Development Analyst to support deal sourcing, financial modelling and due diligence for our investment team. The role is fully remote but candidates should be based within CET +/-2 hours for team overlap.\n\nWhat You'll Do\n- Build LBO and DCF models to support investment theses\n- Screen inbound opportunities and maintain the deal pipeline\n- Coordinate due diligence workstreams with external advisors\n- Prepare investment committee materials and market maps\n- Track portfolio company KPIs against deal-model assumptions\n\nWhat We're Looking For\n- 2-4 years in investment banking, private equity or corporate development\n- Strong Excel and financial modelling skills\n- Comfortable working across multiple live deals at once\n\nWhat We Offer\n- Fully remote, flexible hours\n- Performance bonus tied to closed deals\n- Small team, direct access to partners\n- Annual offsite in a European city\n\nRedshore Capital is an equal opportunity employer and welcomes applications from all backgrounds.",
  },
  {
    title: "AML Investigator",
    company: "SignalForge",
    remote: "full_remote",
    sal: [60000, 75000, "USD"],
    source: "LinkedIn",
    status: "new",
    family: "Risk & Audit",
    h: 18,
    jdFull:
      "SignalForge builds fraud and compliance tooling for digital banks and payment processors across the US and EU. Our Financial Crime team keeps our clients' platforms clean and their regulators satisfied.\n\nThe Role\nWe are hiring an AML Investigator to review flagged transactions, build case files and escalate suspicious activity reports (SARs) in line with EU AMLD5/6 requirements. You'll work closely with our data science team who build the detection models you triage.\n\nWhat You'll Do\n- Investigate alerts generated by transaction-monitoring rules and ML models\n- Draft SARs and liaise with client compliance officers\n- Identify false-positive patterns and feed them back to the detection team\n- Maintain investigation SLAs during high-volume periods\n- Contribute to quarterly typology reviews\n\nRequirements\n- Prior AML/CFT investigation experience, ideally at a bank, PSP or RegTech\n- Familiarity with EU AML directives and sanctions screening\n- Comfortable with high case volume and shifting priorities\n\nWhat We Offer\n- Fully remote across the EU\n- Quarterly team retreats\n- Learning budget for ACAMS certification\n- Health insurance stipend\n\nThis is a demanding role in a regulated environment, we're looking for someone who takes the responsibility seriously.",
  },
  {
    title: "Commercial Analyst",
    company: "Mosaic Cloud",
    city: "warsaw",
    remote: "onsite",
    sal: [110000, 140000, "PLN"],
    source: "StepStone",
    status: "new",
    family: "Business Analysis",
    h: 30,
    jdFull:
      "Mosaic Cloud provides workflow automation software to mid-market manufacturers across Central Europe. Our Warsaw hub houses commercial operations for the CEE region.\n\nThe Role\nWe're looking for a Commercial Analyst to support the regional sales leadership with pricing, deal desk approvals and commercial reporting. This is an onsite role based in our Warsaw office, five days a week.\n\nWhat You'll Do\n- Review and approve non-standard deal terms against pricing policy\n- Build weekly and monthly commercial dashboards for the CEE leadership team\n- Support quarterly business reviews with account-level analysis\n- Maintain the CRM data hygiene that feeds commercial reporting\n- Assist with annual price-list updates across currencies\n\nWhat We're Looking For\n- 2+ years in commercial/sales operations or FP&A\n- Strong Excel skills, SQL a plus\n- Polish and English fluency required\n\nWhat We Offer\n- Modern office in central Warsaw\n- Private healthcare and Multisport card\n- Clear path into a Commercial Finance Manager role\n- Regular team lunches and social events\n\nMosaic Cloud is growing fast in the region and this role will scale with the business.",
    addr: "ul. Emilii Plater 28, 00-688 Warszawa",
  },
  {
    title: "Budget Analyst",
    company: "Cascade Finance",
    city: "krakow",
    remote: "hybrid",
    sal: [90000, 115000, "PLN"],
    source: "Company site",
    status: "checked",
    family: "FP&A",
    h: 45,
    jd: "Boutique FP&A consultancy embedding analysts with mid-market clients in manufacturing and logistics; owns the annual budget cycle and monthly re-forecasts for one or two accounts at a time, working directly with client finance managers.",
    jdFull:
      "Cascade Finance is a boutique financial-planning consultancy that embeds analysts inside mid-market clients across Poland and Germany to run their budgeting cycles. Our Krakow team supports clients in manufacturing, logistics and retail.\n\nThe Role\nAs a Budget Analyst you'll be embedded with one or two clients at a time, owning their annual budget process and monthly re-forecasts. You'll work closely with client finance managers and our internal partners.\n\nWhat You'll Do\n- Coordinate the annual budgeting calendar with client department heads\n- Build and maintain budget-vs-actual variance reports\n- Support monthly re-forecast cycles and flag risks early\n- Document budgeting assumptions and process improvements\n- Present findings in client-facing review meetings\n\nWhat We're Looking For\n- 2-3 years in FP&A, budgeting or management accounting\n- Strong Excel skills; Power BI a plus\n- Polish and English fluent; German a plus\n\nWhat We Offer\n- Hybrid, 2 days/week in our Krakow office\n- Exposure to multiple industries and client cultures\n- Structured mentoring from senior consultants\n- Annual training budget\n\nCascade Finance values analysts who can build trust quickly with client stakeholders.",
    req: [
      "2-3 years in FP&A, budgeting or management accounting",
      "Advanced Excel (variance analysis, budget templates)",
      "Power BI or similar BI tool a plus",
      "Polish and English fluent, German a plus",
      "Comfortable presenting to client stakeholders",
      "Available for occasional client site visits",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2-3 anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred, non vincolante\nLANGUAGE_REQUIRED: Polacco + Inglese, Tedesco plus\n\nRuolo di budgeting in un contesto di consulenza embedded, coerente con esperienza pregressa del candidato in FP&A e reportistica di scostamenti. Il modello a rotazione tra clienti offre varietà ma richiede adattabilità rapida a stack e processi diversi.\nNOTE_MISMATCH: [LANGUAGE] Il tedesco è indicato come plus ma non è nel profilo del candidato.",
  },
  {
    title: "Statutory Reporting Accountant",
    company: "AtlasCare",
    city: "dublin",
    remote: "hybrid",
    sal: [48000, 58000, "EUR"],
    source: "LinkedIn",
    status: "checked",
    family: "Accounting",
    h: 52,
    jd: "Healthtech scale-up expanding across Ireland and the UK: owns statutory accounts preparation under Irish GAAP/IFRS, coordinates the year-end audit and supports the tax advisors on corporation tax filings across entities.",
    jdFull:
      "AtlasCare is a healthtech platform used by clinics across Ireland and the UK to manage patient billing and insurance claims. As we expand into new markets, our finance team is growing to keep pace with statutory obligations in each jurisdiction.\n\nThe Role\nWe're hiring a Statutory Reporting Accountant to own local GAAP and IFRS statutory filings across our Irish and UK entities, working closely with our external auditors and tax advisors.\n\nWhat You'll Do\n- Prepare standalone statutory accounts under Irish GAAP and IFRS\n- Coordinate the year-end audit process with external auditors\n- Reconcile group consolidation adjustments against statutory books\n- Support corporation tax computations with our tax advisors\n- Maintain the statutory filing calendar across entities\n\nWhat We're Looking For\n- Qualified accountant (ACA/ACCA/CIMA) or finalist\n- Statutory reporting or audit background\n- Comfortable managing multiple entity filings in parallel\n\nWhat We Offer\n- Hybrid, 2 days/week in our Dublin office\n- Study support if still finishing qualification\n- Private health insurance\n- 24 days annual leave plus bank holidays\n\nAtlasCare is a mission-driven company and this role sits at the heart of keeping our expansion compliant.",
    req: [
      "Qualified accountant (ACA/ACCA/CIMA) or finalist",
      "Statutory reporting or external audit background",
      "IFRS and Irish GAAP knowledge",
      "Experience managing multi-entity filing calendars",
      "Strong Excel, ERP experience a plus",
      "English fluent",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3-5 anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: required (qualifica ACA/ACCA/CIMA o finalist)\nLANGUAGE_REQUIRED: Inglese\n\nRuolo di statutory reporting in ambito healthtech, allineato all'esperienza di chiusura e reportistica IFRS del candidato. Richiede qualifica contabile formale (ACA/ACCA/CIMA) che il candidato non ha ancora completato.\nNOTE_MISMATCH: [DOMAIN] Qualifica contabile formale richiesta come requisito, il candidato è solo parzialmente qualificato.",
    addr: "32 Fitzwilliam Square, Dublin 2",
  },
  {
    title: "Market Risk Analyst",
    company: "Alpine Risk Partners",
    city: "zurich",
    remote: "hybrid",
    sal: [120000, 145000, "CHF"],
    source: "jobs.ch",
    status: "checked",
    family: "Risk & Audit",
    h: 60,
    jd: "Risk advisory boutique serving Swiss and German asset managers: validates VaR and stress-testing models, supports Basel-aligned regulatory capital work and prepares risk committee materials across buy-side client engagements.",
    jdFull:
      "Alpine Risk Partners advises Swiss and German asset managers on market-risk frameworks, stress testing and regulatory capital modelling. Our Zurich office is the hub for client delivery across the DACH region.\n\nThe Role\nWe're hiring a Market Risk Analyst to join our advisory team, working on VaR model validation, stress-testing frameworks and regulatory reporting projects for buy-side clients.\n\nWhat You'll Do\n- Validate and back-test VaR and expected-shortfall models\n- Build stress-testing scenarios aligned to FINMA and ECB guidance\n- Support clients with Basel-aligned regulatory capital calculations\n- Prepare risk committee materials for client engagements\n- Mentor junior analysts on model documentation standards\n\nWhat We're Looking For\n- 5+ years in market risk, quant risk or risk advisory\n- Strong grasp of VaR methodologies and stress testing\n- Python or R for model validation work\n- CFA or FRM designation a plus\n\nWhat We Offer\n- Hybrid, 3 days/week in our Zurich office\n- Competitive CHF salary with performance bonus\n- Exposure to a broad client base across DACH asset managers\n- Support for further risk certifications\n\nAlpine Risk Partners is a small, technically rigorous team, we hire for depth over breadth.",
    req: [
      "5+ years in market risk, quant risk or risk advisory",
      "Strong VaR and stress-testing methodology knowledge",
      "Python or R for model validation",
      "CFA or FRM a plus",
      "Familiarity with FINMA/Basel regulatory frameworks",
      "German a plus, English fluent required",
    ],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 5+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: Inglese, Tedesco plus\n\nRuolo di risk advisory tecnico e specializzato su modelli VaR, coerente con il background quantitativo del candidato in risk & audit ma con seniority superiore a quella tipicamente ricoperta finora. Il contesto svizzero regolamentato è un plus per la reputazione ma richiede adattamento rapido.\nNOTE_MISMATCH: [SENIORITY] Richiesti 5+ anni specifici in market risk quantitativo, il profilo del candidato è più orientato al credit risk.",
  },
  {
    title: "Revenue Analyst",
    company: "Pipebase",
    remote: "full_remote",
    source: "Company site",
    status: "checked",
    family: "Business Analysis",
    h: 70,
    jd: "SaaS revenue-ops company running its own finance stack on its product principles: owns monthly revenue recognition, subscription-metrics reporting (MRR, churn, NRR) and billing-to-GL reconciliation, fully remote across the EU.",
    jdFull:
      "Pipebase builds revenue-operations tooling for B2B SaaS companies, and we run our own finance function on the same principles we sell: clean data, tight processes, full transparency.\n\nThe Role\nWe're hiring a Revenue Analyst to own our monthly revenue recognition process, subscription metrics reporting and ad hoc analysis for the leadership team. The role is fully remote, open to candidates across the EU.\n\nWhat You'll Do\n- Prepare monthly revenue recognition under ASC 606 / IFRS 15\n- Own MRR, churn and net-revenue-retention reporting\n- Reconcile billing system data against the general ledger\n- Support the sales team with deal-structuring questions\n- Build ad hoc analyses for the leadership team\n\nWhat We're Looking For\n- 2-4 years in revenue accounting, FP&A or RevOps\n- Familiarity with subscription/SaaS metrics\n- Strong SQL and spreadsheet skills\n\nWhat We Offer\n- Fully remote, async-friendly culture\n- Home office stipend\n- Unlimited PTO (with a 20-day minimum encouraged)\n- Annual company retreat\n\nPipebase is a small team that values ownership and clear communication over hours logged.",
    req: [
      "2-4 years in revenue accounting, FP&A or RevOps",
      "Familiarity with ASC 606/IFRS 15 revenue recognition",
      "SaaS subscription metrics experience (MRR, churn, NRR)",
      "Strong SQL and spreadsheet skills",
      "Comfortable in an async, fully remote team",
      "English fluent",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2-4 anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Inglese\n\nRuolo di revenue analysis in ambito SaaS full remote, buon allineamento con l'esperienza di business analysis e reportistica del candidato. Nessuna barriera geografica, azienda con cultura async ben documentata.\nNOTE_MISMATCH: [STACK] Revenue recognition ASC 606/IFRS 15 richiesto in modo specifico, esperienza del candidato è più generalista su FP&A.",
  },
  {
    title: "Senior Accountant",
    company: "Old Mill Industries",
    city: "budapest",
    remote: "hybrid",
    sal: [32000, 40000, "EUR"],
    source: "Indeed",
    status: "scored",
    score: 62,
    family: "Accounting",
    h: 80,
    jd: "Manufacturing group's Budapest shared-service centre: owns month-end close and balance sheet reconciliations for two subsidiaries, supports local-GAAP-to-IFRS consolidation bridges and liaises with local tax advisors on filings.",
    jdFull:
      "Old Mill Industries is a century-old manufacturing group producing industrial components for the automotive and machinery sectors, with a growing finance shared-service centre in Budapest serving our Central European entities.\n\nThe Role\nWe are looking for a Senior Accountant to strengthen our Budapest shared-service team, owning month-end close for two of our subsidiary entities and supporting the group consolidation process.\n\nWhat You'll Do\n- Own month-end close for two manufacturing subsidiaries\n- Prepare balance sheet reconciliations and intercompany eliminations\n- Support the group consolidation team with local GAAP-to-IFRS bridges\n- Liaise with local tax advisors on VAT and corporate tax filings\n- Assist with the annual statutory audit\n\nWhat We're Looking For\n- 4+ years in general ledger accounting or audit\n- Experience in a manufacturing or industrial environment a plus\n- SAP experience preferred\n\nWhat We Offer\n- Hybrid, 2 days/week in our Budapest office\n- Cafeteria benefits package\n- Stable, established group with long tenure culture\n- Structured career path within the shared-service centre\n\nOld Mill Industries has been through several ownership changes in recent years and is now stabilising its finance organisation.",
    req: [
      "4+ years in general ledger accounting or audit",
      "Manufacturing/industrial environment experience a plus",
      "SAP experience preferred",
      "Local GAAP to IFRS bridging knowledge",
      "Hungarian and English fluent",
      "Comfortable with intercompany reconciliations",
    ],
    pros: [
      "Contesto stabile con shared-service center strutturato",
      "Percorso di crescita definito all'interno del team",
    ],
    cons: [
      "Ungherese richiesto per parte del ruolo, gap linguistico",
      "Storia recente di instabilità societaria",
    ],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 4+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: Ungherese + Inglese\n\nRuolo di general ledger accounting in un contesto manifatturiero stabile ma con storia di cambi di proprietà recenti, elemento da monitorare per la reputazione aziendale (recensioni Glassdoor nella media, 3.4). SAP richiesto come preferenziale, il candidato ha esperienza su altri ERP.\nNOTE_MISMATCH: [LANGUAGE] Ungherese richiesto per l'interfaccia con gli advisor locali, il candidato non lo parla.",
    scoreNotes:
      "Punteggio nella media: buon match tecnico su general ledger e consolidamento ma il requisito linguistico locale e il contesto SAP non allineato pesano sul punteggio.",
    addr: "Váci út 81, 1139 Budapest",
  },
  {
    title: "AP/AR Specialist",
    company: "Weblab Italia",
    city: "torino",
    remote: "onsite",
    sal: [26000, 30000, "EUR"],
    source: "Indeed",
    status: "scored",
    score: 50,
    family: "Accounting",
    h: 92,
    jd: "Small digital agency in Torino handling billing for ~80 SME clients: owns AP/AR processing, payment runs, invoice issuance and collections chasing, with basic bookkeeping support to the office manager, fully onsite.",
    jdFull:
      "Weblab Italia is a digital agency serving SMEs across Northern Italy with web development and e-commerce services. Our small finance team handles billing and collections for a growing client base.\n\nThe Role\nWe're looking for an AP/AR Specialist to join our Torino office, managing supplier invoices, client billing and collections for our roughly 80 active client accounts.\n\nWhat You'll Do\n- Process supplier invoices and prepare payment runs\n- Issue client invoices and track collections\n- Chase overdue accounts and escalate persistent late payers\n- Reconcile the AP/AR sub-ledgers monthly\n- Support the office manager with basic bookkeeping tasks\n\nWhat We're Looking For\n- 1-2 years in accounts payable/receivable or general bookkeeping\n- Comfortable with Excel and basic accounting software\n- Precise and organised, comfortable chasing overdue clients\n\nWhat We Offer\n- Onsite role in our Torino office, five days a week\n- Friendly small-team environment\n- Buoni pasto\n- Growth into a broader accounting role over time\n\nWeblab Italia is a small, family-run agency where everyone wears multiple hats.",
    req: [
      "1-2 years in AP/AR or bookkeeping",
      "Comfortable with Excel and basic accounting software",
      "Precise and organised approach to reconciliations",
      "Comfortable chasing overdue accounts",
      "Italian native, basic English",
    ],
    pros: [
      "Ruolo alla portata immediata dell'esperienza pregressa",
      "Ambiente piccolo con possibilità di crescita graduale",
    ],
    cons: [
      "Full onsite senza flessibilità",
      "Range salariale contenuto per il livello di responsabilità",
    ],
    notes:
      "SENIORITY_JD: junior\nEXPERIENCE_REQUIRED: 1-2 anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Italiano, Inglese base\n\nRuolo AP/AR entry-level in una piccola agenzia, coerente con esperienza di accounting di base del candidato ma con responsabilità piuttosto ristrette rispetto al percorso di crescita desiderato. Full onsite cinque giorni a settimana, nessuna flessibilità.\nNOTE_MISMATCH: [GEO] Ruolo full onsite senza alcuna flessibilità ibrida, meno allineato alle preferenze del candidato.",
    scoreNotes:
      "Punteggio medio-basso: mansioni base coerenti col profilo ma stipendio e assenza di ibrido limitano l'attrattività rispetto ad altre posizioni simili valutate.",
  },
  {
    title: "Tax Accountant",
    company: "Meridian Ledger",
    city: "vienna",
    remote: "hybrid",
    sal: [50000, 62000, "EUR"],
    source: "StepStone",
    status: "scored",
    score: 58,
    family: "Accounting",
    h: 100,
    jd: "Outsourced accounting and tax firm in Vienna managing ~40 client mandates: prepares VAT returns and corporate tax provisions, supports clients through tax audits and tracks Austrian tax law changes across the portfolio.",
    jdFull:
      "Meridian Ledger is an outsourced accounting and tax firm serving mid-sized companies across Austria and Southern Germany. Our Vienna office runs corporate tax compliance for around 40 client mandates.\n\nThe Role\nWe are hiring a Tax Accountant to manage corporate tax compliance for a portfolio of client mandates, from VAT returns to annual corporate tax computations.\n\nWhat You'll Do\n- Prepare monthly and quarterly VAT returns for client mandates\n- Compute annual corporate income tax provisions\n- Respond to routine tax authority queries\n- Support clients during tax audits\n- Keep up to date with Austrian tax law changes relevant to clients\n\nWhat We're Looking For\n- 3+ years in corporate tax or outsourced accounting\n- Austrian tax law knowledge (VAT, corporate income tax)\n- Comfortable managing multiple client mandates in parallel\n\nWhat We Offer\n- Hybrid, 2 days/week in our Vienna office\n- Structured CPD support for further tax qualifications\n- Client portfolio variety across industries\n- Collegial, no-overtime-culture team\n\nMeridian Ledger prides itself on sustainable workloads even during tax season.",
    req: [
      "3+ years in corporate tax or outsourced accounting",
      "Austrian VAT and corporate income tax knowledge",
      "Experience managing multiple client mandates",
      "German and English fluent",
      "Comfortable with client-facing tax queries",
    ],
    pros: [
      "Portfolio clienti vario che amplia l'esperienza",
      "Cultura aziendale attenta al carico di lavoro",
    ],
    cons: [
      "Normativa fiscale locale specifica non nel background",
      "Tedesco fluente come requisito vincolante",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: Tedesco + Inglese\n\nRuolo di tax compliance su normativa fiscale austriaca specifica, ambito diverso da quello prevalente nell'esperienza del candidato (accounting generalista IFRS). Il tedesco fluente richiesto è un vincolo rilevante.\nNOTE_MISMATCH: [DOMAIN] Conoscenza specifica della normativa fiscale austriaca richiesta, il candidato non ha esperienza diretta in questo ambito.",
    scoreNotes:
      "Punteggio contenuto per via del gap di dominio su fiscalità austriaca e del requisito linguistico, nonostante la solidità generale del profilo accounting.",
  },
  {
    title: "Operational Risk Analyst",
    company: "Cargolane",
    city: "hamburg",
    remote: "hybrid",
    sal: [55000, 68000, "EUR"],
    source: "Xing",
    status: "scored",
    score: 65,
    family: "Risk & Audit",
    h: 110,
    jd: "Freight-forwarding marketplace scaling fast: builds out the operational risk framework covering payments, carrier onboarding and third-party risk, running incident root-cause analysis and quarterly risk reporting for leadership.",
    jdFull:
      "Cargolane operates a freight-forwarding platform connecting European shippers with carriers. As our transaction volumes grow, so does our exposure to operational risk across payments, carrier onboarding and claims.\n\nThe Role\nWe're hiring an Operational Risk Analyst to build out our operational risk framework, covering process failures, third-party risk and payment-related incidents.\n\nWhat You'll Do\n- Maintain the operational risk register and incident log\n- Run root-cause analysis on payment and onboarding incidents\n- Support carrier due-diligence and third-party risk assessments\n- Prepare quarterly risk reporting for the leadership team\n- Contribute to business-continuity planning\n\nWhat We're Looking For\n- 3+ years in operational risk, internal audit or risk advisory\n- Comfortable running root-cause analysis independently\n- Logistics or marketplace experience a plus\n\nWhat We Offer\n- Hybrid, 2 days/week in our Hamburg office\n- Direct exposure to the COO and Head of Risk\n- Stock options\n- Structured onboarding into the operational risk framework\n\nCargolane is scaling fast and this is a build-from-relative-scratch opportunity.",
    req: [
      "3+ years in operational risk, internal audit or risk advisory",
      "Comfortable running root-cause analysis independently",
      "Logistics or marketplace experience a plus",
      "Strong written reporting skills",
      "English fluent, German a plus",
    ],
    pros: [
      "Ruolo di costruzione del framework, alto impatto",
      "Esposizione diretta a COO e Head of Risk",
    ],
    cons: [
      "Dominio logistico nuovo rispetto al background",
      "Framework da costruire senza processi consolidati",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Inglese, Tedesco plus\n\nRuolo di risk operativo in un marketplace logistico in crescita, buon allineamento con l'esperienza di risk & audit del candidato pur trattandosi di un dominio (logistica) nuovo. Framework da costruire sostanzialmente da zero, opportunità di impatto alto.\nNOTE_MISMATCH: [DOMAIN] Settore logistico/marketplace non presente nel background diretto del candidato.",
    scoreNotes:
      "Punteggio nella media-alta: solido fit sulle competenze di risk operativo, penalizzato lievemente dalla novità del settore logistico.",
    addr: "Speicherstadt 12, 20457 Hamburg",
  },
  {
    title: "Compliance Officer",
    company: "NovaPay",
    city: "dublin",
    remote: "hybrid",
    sal: [70000, 85000, "EUR"],
    source: "eFinancialCareers",
    status: "scored",
    score: 71,
    family: "Risk & Audit",
    h: 118,
    jd: "Licensed EEA e-money institution: strengthens the second-line compliance function through regulatory horizon-scanning, policy maintenance, Central Bank of Ireland reporting support and internal compliance training.",
    jdFull:
      "NovaPay is a licensed e-money institution offering payment accounts and cards to consumers across the EEA. Regulatory compliance is core to how we operate and grow.\n\nThe Role\nWe are hiring a Compliance Officer to strengthen our second-line compliance function, covering regulatory horizon-scanning, policy maintenance and support for our Central Bank of Ireland relationship.\n\nWhat You'll Do\n- Monitor regulatory developments relevant to e-money institutions\n- Maintain and update internal compliance policies\n- Support regulatory reporting and Central Bank of Ireland engagement\n- Run compliance training sessions for internal teams\n- Assist with the annual compliance monitoring plan\n\nWhat We're Looking For\n- 5+ years in financial services compliance\n- E-money or payments regulatory experience preferred\n- Strong stakeholder management skills\n\nWhat We Offer\n- Hybrid, 2 days/week in our Dublin office\n- Direct line to the Head of Compliance and MLRO\n- Study support for compliance certifications\n- Comprehensive health package\n\nNovaPay holds a full e-money licence and compliance is treated as a strategic function, not an afterthought.",
    req: [
      "5+ years in financial services compliance",
      "E-money or payments regulatory experience preferred",
      "Strong stakeholder management and policy-writing skills",
      "Experience with Central Bank of Ireland or equivalent regulator engagement a plus",
      "English fluent",
    ],
    pros: [
      "Istituto con licenza piena e reputazione solida",
      "Esposizione diretta a Head of Compliance e MLRO",
    ],
    cons: [
      "Seniority e specializzazione richieste superiori al profilo attuale",
      "Ambito compliance regolamentare puro, non risk quantitativo",
    ],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 5+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: Inglese\n\nRuolo di compliance regolamentare in un istituto di moneta elettronica con licenza piena, contesto solido e reputazione buona (Glassdoor 4.0). Seniority richiesta superiore rispetto al livello finora ricoperto dal candidato, principalmente su credit risk piuttosto che compliance regolamentare.\nNOTE_MISMATCH: [SENIORITY] Richiesti 5+ anni specifici in compliance regolamentare, il candidato ha esperienza adiacente in risk ma non compliance diretta.",
    scoreNotes:
      "Punteggio discreto grazie alla solidità del contesto regolamentare, ma il gap di specializzazione tra risk e compliance pura limita il fit.",
  },
  {
    title: "Financial Business Analyst",
    company: "Solventra",
    city: "rotterdam",
    remote: "full_remote",
    sal: [55000, 68000, "EUR"],
    source: "Wellfound",
    status: "scored",
    score: 60,
    family: "Business Analysis",
    h: 126,
    jd: "SaaS AR-automation company scaling go-to-market: bridges finance and product through unit-economics dashboards, pricing/packaging analysis and quarterly investor reporting, fully remote across the EU.",
    jdFull:
      "Solventra builds accounts-receivable automation software for mid-market companies across the Benelux. Our finance team practises what we sell: fast closes, clean data, minimal manual work.\n\nThe Role\nWe're hiring a Financial Business Analyst to bridge our finance and product teams, translating business questions into data-driven analysis and supporting pricing and packaging decisions.\n\nWhat You'll Do\n- Build and maintain unit-economics dashboards (CAC, LTV, payback)\n- Support pricing and packaging experiments with financial modelling\n- Partner with product on feature ROI analysis\n- Prepare investor-update financial slides quarterly\n- Automate recurring reporting using SQL and BI tools\n\nWhat We're Looking For\n- 3+ years in FP&A, business analysis or strategy consulting\n- Strong SQL skills, comfortable querying production data\n- Experience with SaaS unit economics\n\nWhat We Offer\n- Fully remote across the EU\n- Quarterly in-person team weeks\n- Learning budget\n- Equity package\n\nSolventra is a Series B company scaling its go-to-market motion and finance is a key partner in that process.",
    req: [
      "3+ years in FP&A, business analysis or strategy consulting",
      "Strong SQL skills against production data",
      "SaaS unit-economics experience (CAC, LTV, payback)",
      "Comfortable building investor-facing materials",
      "English fluent",
    ],
    pros: [
      "Full remote EU senza vincoli geografici",
      "Azienda Series B con reputazione solida",
      "Ruolo cross-funzionale con esposizione a prodotto",
    ],
    cons: ["SQL richiesto a un livello più intensivo del solito"],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Inglese\n\nRuolo di business analysis full remote ben allineato con l'esperienza del candidato su modellazione e reportistica, con enfasi su SQL più marcata rispetto ai ruoli precedenti. Azienda Series B con buona reputazione (Glassdoor 4.1).\nNOTE_MISMATCH: [STACK] SQL richiesto come competenza core quotidiana, il candidato lo usa in modo più occasionale.",
    scoreNotes:
      "Punteggio nella media-alta: buon fit complessivo penalizzato solo dal livello di SQL richiesto, superiore all'uso occasionale del candidato.",
  },
  {
    title: "Data & Insights Analyst",
    company: "Fluxwave",
    remote: "full_remote",
    source: "LinkedIn",
    status: "scored",
    score: 68,
    family: "Business Analysis",
    h: 134,
    jd: "Embedded-finance infrastructure company: builds self-serve Looker dashboards for FP&A and leadership, runs cohort and unit-economics analysis and investigates anomalies across financial and operational KPIs, fully remote.",
    jdFull:
      "Fluxwave provides embedded finance infrastructure to marketplaces and fintech apps. Our internal Insights team turns operational and financial data into decisions across the company.\n\nThe Role\nWe're hiring a Data & Insights Analyst to sit within the finance org, supporting FP&A and the executive team with ad hoc analysis and self-serve reporting.\n\nWhat You'll Do\n- Build and maintain self-serve dashboards in Looker\n- Support FP&A with cohort and unit-economics analysis\n- Investigate anomalies in financial and operational KPIs\n- Write clear analysis memos for leadership decisions\n- Maintain the metrics glossary and data documentation\n\nWhat We're Looking For\n- 2-4 years in data/business analysis, ideally fintech-adjacent\n- Strong SQL, dbt experience a plus\n- Comfortable communicating findings to non-technical stakeholders\n\nWhat We Offer\n- Fully remote, EU or UK based\n- Flexible hours, async-first culture\n- Home office budget\n- Annual learning stipend\n\nFluxwave is a data-driven company and this role sits close to every major decision.",
    req: [
      "2-4 years in data/business analysis, fintech-adjacent a plus",
      "Strong SQL, dbt experience a plus",
      "Comfortable with Looker or similar BI tools",
      "Clear written communication for leadership memos",
      "English fluent",
    ],
    pros: [
      "Ruolo full remote con azienda data-driven",
      "Nessun requisito bloccante su dbt",
      "Buona visibilità sulle decisioni aziendali",
    ],
    cons: ["Ambito fintech-adjacent parzialmente nuovo"],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2-4 anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Inglese\n\nRuolo ibrido tra data analysis e business analysis, full remote, con buon allineamento generale al profilo del candidato. Il dbt è indicato come plus e non requisito bloccante.\nNOTE_MISMATCH: [STACK] dbt indicato come plus, il candidato non lo ha mai usato ma il gap è dichiarato non bloccante.",
    scoreNotes:
      "Punteggio buono: fit solido su analisi e reportistica, gap minori su strumenti specifici non bloccanti per la candidatura.",
  },
  {
    title: "Strategy & Ops Analyst",
    company: "Kernelworks",
    remote: "full_remote",
    sal: [90000, 115000, "USD"],
    source: "Hacker News",
    status: "scored",
    score: 75,
    family: "Business Analysis",
    h: 142,
    jd: "AI-infrastructure startup, post-Series A: supports the CEO on strategic planning, market-sizing for new product bets, quarterly OKR tracking and board-ready strategy memos, fully remote across US/EU timezones.",
    jdFull:
      "Kernelworks is a developer-tools startup building infrastructure for AI application deployment. We're a distributed team and run our strategy function lean.\n\nThe Role\nWe're hiring a Strategy & Ops Analyst to support the CEO and leadership team on strategic planning, market analysis and cross-functional operational projects.\n\nWhat You'll Do\n- Lead market-sizing and competitive analysis for new product bets\n- Support annual and quarterly planning cycles\n- Run cross-functional projects to unblock operational bottlenecks\n- Prepare board-ready strategic memos\n- Track OKRs and surface risks to leadership\n\nWhat We're Looking For\n- 4-6 years in strategy consulting, corporate strategy or BizOps\n- Excellent structured problem-solving and writing skills\n- Comfortable operating with high autonomy in a remote team\n\nWhat We Offer\n- Fully remote, US or EU timezones\n- Competitive USD-denominated salary\n- Meaningful equity\n- Small, high-trust team\n\nKernelworks is post-Series A and this role reports directly into the CEO.",
    req: [
      "4-6 years in strategy consulting, corporate strategy or BizOps",
      "Excellent structured problem-solving and writing",
      "Comfortable with high autonomy in a remote team",
      "Experience preparing board-level materials",
      "English fluent",
    ],
    pros: [
      "Riporto diretto al CEO, alta visibilità",
      "Full remote con retribuzione in USD competitiva",
    ],
    cons: [
      "Seniority richiesta superiore all'esperienza attuale in strategy",
      "Team piccolo, alta autonomia richiesta senza rete di supporto ampia",
    ],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 4-6 anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: Inglese\n\nRuolo strategico full remote a diretto riporto del CEO, coerente con l'esperienza di business analysis del candidato ma con seniority e autonomia richieste elevate. Stipendio in USD compatibile con remote extra-UE.\nNOTE_MISMATCH: [SENIORITY] Richiesta esperienza in strategy consulting o corporate strategy, il background del candidato è più operativo/analitico.",
    scoreNotes:
      "Punteggio discreto: ruolo interessante ma il gap di seniority specifica in strategy consulting rispetto al profilo più analitico del candidato pesa sulla valutazione.",
  },
  {
    title: "Treasury Manager",
    company: "Helvetia Systems",
    city: "zurich",
    remote: "hybrid",
    sal: [140000, 165000, "CHF"],
    source: "LinkedIn",
    status: "scored",
    score: 78,
    family: "Treasury",
    h: 150,
    jd: "Swiss industrial group centralising treasury in Zurich: leads cash positioning, FX hedging programme and banking relationships for the European entities, with a TMS migration project and one direct report.",
    jdFull:
      "Helvetia Systems is a Swiss industrial group manufacturing precision components for the energy sector, with treasury operations centralised in Zurich for the group's European entities.\n\nThe Role\nWe are hiring a Treasury Manager to lead cash management, FX hedging and banking relationships for the group, reporting to the Group Treasurer.\n\nWhat You'll Do\n- Own daily cash positioning and short-term liquidity planning\n- Manage the group's FX hedging programme\n- Maintain and negotiate banking facilities and covenants\n- Lead the rollout of a new treasury management system (TMS)\n- Mentor one junior treasury analyst\n\nWhat We're Looking For\n- 6+ years in corporate treasury, ideally in an industrial group\n- Hands-on FX hedging experience\n- Experience implementing or migrating a TMS a plus\n\nWhat We Offer\n- Hybrid, 3 days/week in our Zurich office\n- CHF salary with strong benefits package\n- Direct exposure to the Group Treasurer and CFO\n- Leadership track within the treasury function\n\nHelvetia Systems is a stable, well-capitalised group with a long-term view on its treasury organisation.",
    req: [
      "6+ years in corporate treasury, industrial group experience a plus",
      "Hands-on FX hedging experience",
      "TMS implementation or migration experience a plus",
      "People-management experience (one direct report)",
      "German and English fluent",
    ],
    pros: [
      "Gruppo industriale stabile e ben capitalizzato",
      "Percorso di leadership chiaro nella funzione treasury",
      "Progetto di migrazione TMS ad alto contenuto tecnico",
    ],
    cons: [
      "Tedesco fluente richiesto, gap linguistico",
      "Salto di seniority verso gestione di un riporto diretto",
    ],
    notes:
      "SENIORITY_JD: lead\nEXPERIENCE_REQUIRED: 6+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: Tedesco + Inglese\n\nRuolo di leadership in treasury con riporto diretto al Group Treasurer, buon allineamento con l'esperienza pregressa del candidato in treasury ma con un salto di seniority verso la gestione di un team. Il tedesco fluente è un vincolo non pienamente coperto.\nNOTE_MISMATCH: [LANGUAGE] Tedesco fluente richiesto per le relazioni bancarie locali, il candidato ha solo inglese professionale.",
    scoreNotes:
      "Punteggio buono grazie alla solidità del contesto e all'affinità di dominio, penalizzato dal requisito linguistico e dal salto di seniority verso un ruolo people-manager.",
    addr: "Bahnhofstrasse 45, 8001 Zürich",
  },
  {
    title: "Cash Management Analyst",
    company: "Brightpeak Advisory",
    city: "helsinki",
    remote: "hybrid",
    sal: [48000, 58000, "EUR"],
    source: "LinkedIn",
    status: "scored",
    score: 55,
    family: "Treasury",
    h: 158,
    jd: "Nordic corporate finance advisory firm: supports client engagements on 13-week cash-flow forecasting, working-capital optimisation and banking relationship reviews for mid-market companies.",
    jdFull:
      "Brightpeak Advisory is a corporate finance advisory firm serving Nordic mid-market companies on treasury, working-capital and liquidity projects.\n\nThe Role\nWe're hiring a Cash Management Analyst to support client engagements on cash-flow forecasting, working-capital optimisation and short-term liquidity planning.\n\nWhat You'll Do\n- Build 13-week cash-flow forecasts for client engagements\n- Analyse working-capital drivers and recommend improvements\n- Support banking relationship reviews for clients\n- Prepare client-facing liquidity reports\n- Assist senior consultants on treasury advisory projects\n\nWhat We're Looking For\n- 2-3 years in treasury, cash management or corporate finance advisory\n- Strong Excel modelling skills\n- Nordic market exposure a plus\n\nWhat We Offer\n- Hybrid, 2 days/week in our Helsinki office\n- Exposure to a range of Nordic mid-market clients\n- Structured mentoring from senior treasury consultants\n- Competitive salary with performance bonus\n\nBrightpeak Advisory is a small, growing advisory practice with an informal, direct culture.",
    req: [
      "2-3 years in treasury, cash management or corporate finance advisory",
      "Strong Excel modelling skills",
      "Nordic market exposure a plus",
      "Comfortable in a client-facing advisory role",
      "English fluent, Finnish/Swedish a plus",
    ],
    pros: [
      "Buona base di competenze cash management trasferibili",
      "Ambiente piccolo con mentoring diretto",
    ],
    cons: [
      "Componente consulenziale client-facing non praticata",
      "Reputazione aziendale ancora poco consolidata",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2-3 anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Inglese, Finlandese/Svedese plus\n\nRuolo di treasury advisory in un contesto nordico, coerente con l'esperienza del candidato su cash management ma con una componente consulenziale e client-facing meno praticata finora. Azienda piccola con reputazione non ancora consolidata online.\nNOTE_MISMATCH: [GEO] Contesto di mercato nordico specifico, meno familiare rispetto all'esperienza prevalentemente DACH/UE del candidato.",
    scoreNotes:
      "Punteggio nella media: competenze tecniche trasferibili ma il salto verso un ruolo advisory client-facing in mercato nordico introduce incertezza.",
  },
  {
    title: "Corporate FP&A Lead",
    company: "Snapdeck",
    city: "copenhagen",
    remote: "hybrid",
    sal: [650000, 780000, "DKK"],
    source: "Otta",
    status: "writing",
    score: 84,
    family: "FP&A",
    h: 40,
    wr: true,
    jd: "Nordic e-commerce logistics platform pre-Series C: owns the group forecast model across four markets, leads the annual budget process, manages a two-person FP&A team and partners with country GMs and the CFO on board reporting.",
    jdFull:
      "Snapdeck is a Nordic e-commerce logistics platform connecting online retailers with last-mile carriers across Scandinavia. As we approach Series C, our finance organisation is professionalising fast.\n\nThe Role\nWe are hiring a Corporate FP&A Lead to own the group forecasting model, lead the annual budgeting process and manage a small team of two analysts, reporting directly to the CFO.\n\nWhat You'll Do\n- Own the driver-based group forecast model across four markets\n- Lead the annual budget process end-to-end\n- Manage and develop a team of two FP&A analysts\n- Prepare the monthly board reporting pack with the CFO\n- Partner with country GMs on local P&L ownership\n\nWhat We're Looking For\n- 6+ years in FP&A, with at least 2 years managing a team\n- Multi-entity or multi-market forecasting experience\n- Strong communicator, comfortable presenting to the board\n\nWhat We Offer\n- Hybrid, 3 days/week in our Copenhagen office\n- Competitive salary plus equity ahead of Series C\n- Direct partnership with the CFO\n- Real people-management scope from day one\n\nSnapdeck has grown 3x in two years and this role is central to keeping finance ahead of that growth.",
    req: [
      "6+ years in FP&A, 2+ years managing a team",
      "Multi-entity or multi-market forecasting experience",
      "Strong board-level communication skills",
      "Experience partnering with country/regional GMs",
      "English fluent, Danish a plus",
    ],
    pros: [
      "Contesto di crescita forte e ben finanziato pre-Series C",
      "Riporto diretto al CFO con alta visibilità",
      "Modello multi-mercato che amplia le competenze",
    ],
    cons: [
      "Prima esperienza di gestione team richiesta come requisito",
      "Ritmo di crescita rapido implica carico elevato in periodi di chiusura/budget",
    ],
    notes:
      "SENIORITY_JD: lead\nEXPERIENCE_REQUIRED: 6+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: Inglese, Danese plus\n\nRuolo di leadership FP&A con gestione di un team di due analisti e riporto diretto al CFO, in un contesto di forte crescita (3x in due anni) con reputazione solida (Glassdoor 4.3). Buon allineamento con l'esperienza di modellazione e reportistica del candidato, primo salto verso la gestione di persone.\nNOTE_MISMATCH: [SENIORITY] Richiesta esperienza pregressa di people management, il candidato non ha ancora gestito un team direttamente.",
    scoreNotes:
      "Punteggio alto: forte allineamento tecnico e di dominio, con l'unico limite nella mancanza di esperienza pregressa di people management diretta, comunque compensabile dal potenziale del candidato.",
    addr: "Vesterbrogade 149, 1620 København",
  },
  {
    title: "M&A Associate",
    company: "Portico Advisors",
    city: "lisbon",
    remote: "hybrid",
    sal: [42000, 55000, "EUR"],
    source: "eFinancialCareers",
    status: "writing",
    score: 76,
    family: "M&A / Deals",
    h: 66,
    wr: true,
    jd: "Boutique M&A advisory firm running mid-market mandates across Southern Europe: builds valuation models, drafts teasers and IMs, coordinates due diligence workstreams and supports transaction-document negotiation on live deals.",
    jdFull:
      "Portico Advisors is a boutique M&A advisory firm focused on mid-market transactions across Southern Europe, from origination through to deal close.\n\nThe Role\nWe're hiring an M&A Associate to support deal execution across our live mandates, from valuation work through to due diligence coordination and closing documentation.\n\nWhat You'll Do\n- Build valuation models (DCF, comparables, precedent transactions)\n- Draft investment teasers and information memoranda\n- Coordinate due diligence workstreams with buyers and advisors\n- Support negotiation of transaction documents alongside legal counsel\n- Maintain deal trackers and pipeline reporting for partners\n\nWhat We're Looking For\n- 2-4 years in M&A, investment banking or transaction advisory\n- Strong financial modelling and valuation skills\n- Portuguese or Spanish language a plus for local mandates\n\nWhat We Offer\n- Hybrid, 3 days/week in our Lisbon office\n- Deal bonus on top of base salary\n- Direct exposure to partners on every live mandate\n- Fast-track path to Senior Associate\n\nPortico Advisors runs lean deal teams, meaning associates get real responsibility from their first mandate.",
    req: [
      "2-4 years in M&A, investment banking or transaction advisory",
      "Strong DCF, comparables and precedent-transaction modelling",
      "Experience drafting teasers and information memoranda",
      "Portuguese or Spanish a plus",
      "English fluent, comfortable under deal deadlines",
    ],
    pros: [
      "Responsabilità dirette su mandati live fin da subito",
      "Team lean con esposizione costante ai partner",
      "Percorso di crescita rapido verso Senior Associate",
    ],
    cons: [
      "Retribuzione variabile legata al deal bonus, meno prevedibile",
      "Ritmi intensi tipici del boutique M&A",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2-4 anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: Inglese, Portoghese/Spagnolo plus\n\nRuolo di execution M&A in una boutique lean con responsabilità dirette fin dal primo mandato, coerente con l'esperienza del candidato in valuation e due diligence. Il portoghese/spagnolo è un plus non bloccante.\nNOTE_MISMATCH: [SALARY] Il bonus deal-based rende la retribuzione totale meno prevedibile rispetto a un pacchetto fisso più alto.",
    scoreNotes:
      "Punteggio buono: forte coerenza tecnica sulla modellazione e sulla due diligence, lievemente penalizzato dalla componente variabile della retribuzione.",
  },
  {
    title: "Liquidity Analyst",
    company: "Northgate Capital",
    city: "oslo",
    remote: "hybrid",
    sal: [650000, 780000, "NOK"],
    source: "LinkedIn",
    status: "review",
    score: 73,
    family: "Treasury",
    h: 175,
    critic: [4, "NEEDS_WORK"],
    jd: "Nordic asset manager centralising liquidity risk oversight in Oslo: monitors daily fund-level liquidity, runs redemption stress tests and supports UCITS/AIFMD liquidity reporting for the risk committee.",
    jdFull:
      "Northgate Capital is an asset manager running fixed-income and money-market funds for Nordic institutional investors, with liquidity risk oversight centralised in our Oslo office.\n\nThe Role\nWe're hiring a Liquidity Analyst to monitor fund-level liquidity, run stress tests and support regulatory liquidity reporting across our fund range.\n\nWhat You'll Do\n- Monitor daily liquidity positions across the fund range\n- Run liquidity stress tests under various redemption scenarios\n- Support UCITS/AIFMD liquidity reporting requirements\n- Prepare liquidity risk papers for the risk committee\n- Liaise with portfolio managers on liquidity-constrained positions\n\nWhat We're Looking For\n- 2-4 years in liquidity risk, fund risk or asset management operations\n- Familiarity with UCITS/AIFMD liquidity requirements a plus\n- Strong Excel skills, Python a plus\n\nWhat We Offer\n- Hybrid, 2 days/week in our Oslo office\n- NOK salary with pension contribution above statutory minimum\n- Exposure to portfolio managers and the risk committee\n- Structured training on regulatory liquidity frameworks\n\nNorthgate Capital manages liquidity conservatively and this role sits close to that discipline.",
    req: [
      "2-4 years in liquidity risk, fund risk or asset management operations",
      "Familiarity with UCITS/AIFMD liquidity requirements a plus",
      "Strong Excel skills, Python a plus",
      "Comfortable liaising with portfolio managers",
      "English fluent, Norwegian a plus",
    ],
    pros: [
      "Contesto regolamentato con buona reputazione",
      "Esposizione diretta a portfolio manager e risk committee",
    ],
    cons: [
      "Dominio liquidity risk specifico, non praticato direttamente",
      "Framework UCITS/AIFMD da apprendere ex novo",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2-4 anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: Inglese, Norvegese plus\n\nRuolo di liquidity risk in asset management, ambito adiacente ma distinto dal credit risk del candidato. Buona reputazione aziendale (Glassdoor 4.0) e retribuzione in corona norvegese coerente col mercato locale.\nNOTE_MISMATCH: [DOMAIN] Liquidity risk in fondi UCITS/AIFMD è un dominio specifico diverso dal credit risk prevalente nel background.",
    scoreNotes:
      "Punteggio nella media-alta: solide basi di risk quantitativo ma il dominio specifico della liquidity risk in fondi regolamentati richiede un ramp-up significativo.",
    criticNotes:
      "Round 1: 5/10, Round 2: 4/10. Verdict: NEEDS_WORK. Strength: solido framework di risk analysis trasferibile e buona capacità di stress-testing. Gap: nessuna esperienza diretta su UCITS/AIFMD citata nel CV, il draft attuale forza analogie con il credit risk che non reggono a un secondo esame; da riscrivere enfatizzando le competenze quantitative trasferibili senza sovra-vendere il dominio liquidity.",
  },
  {
    title: "General Ledger Accountant",
    company: "Ferrovia Logistics",
    city: "porto",
    remote: "onsite",
    sal: [32000, 40000, "EUR"],
    source: "Indeed",
    status: "review",
    score: 79,
    family: "Accounting",
    h: 183,
    jd: "Iberian rail-freight operator's Porto finance office: owns month-end close and fixed-asset accounting for two operating entities, prepares balance sheet reconciliations and supports the annual statutory audit.",
    jdFull:
      "Ferrovia Logistics operates rail and intermodal freight services across the Iberian Peninsula. Our Porto finance office handles accounting for the group's Portuguese and Spanish operating entities.\n\nThe Role\nWe're hiring a General Ledger Accountant to own month-end close, fixed-asset accounting and balance sheet reconciliations for two operating entities.\n\nWhat You'll Do\n- Own month-end close for two operating entities\n- Maintain the fixed-asset register and depreciation schedules\n- Prepare balance sheet reconciliations and journal entries\n- Support the annual statutory audit\n- Assist with intercompany reconciliation across the group\n\nWhat We're Looking For\n- 3+ years in general ledger accounting\n- ERP experience (SAP or similar)\n- Portuguese and English fluent, Spanish a plus\n\nWhat We Offer\n- Onsite role in our Porto office\n- Meal allowance and health insurance\n- Stable, long-established group\n- Clear progression path to Senior Accountant\n\nFerrovia Logistics has operated in the region for over 40 years and offers a stable, structured finance environment.",
    req: [
      "3+ years in general ledger accounting",
      "ERP experience (SAP or similar)",
      "Fixed-asset accounting experience",
      "Portuguese and English fluent, Spanish a plus",
      "Comfortable with intercompany reconciliations",
    ],
    pros: [
      "Contesto stabile con oltre 40 anni di storia",
      "Percorso di crescita chiaro verso Senior Accountant",
    ],
    cons: [
      "Portoghese fluente richiesto, gap linguistico rilevante",
      "Ruolo full onsite senza flessibilità",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: Portoghese + Inglese, Spagnolo plus\n\nRuolo di general ledger in un gruppo ferroviario stabile e di lunga storia, buon allineamento tecnico con l'esperienza di chiusura e riconciliazioni del candidato. Il portoghese fluente è un requisito vincolante non coperto.\nNOTE_MISMATCH: [LANGUAGE] Portoghese fluente richiesto per l'operatività quotidiana, il candidato non lo parla.",
    scoreNotes:
      "Punteggio buono sul piano tecnico-contabile, ma il requisito linguistico vincolante del portoghese rappresenta un ostacolo concreto all'idoneità pratica.",
    addr: "Rua de Santa Catarina 312, 4000-447 Porto",
  },
  {
    title: "FX Trader Junior",
    company: "Quantera",
    city: "frankfurt",
    remote: "onsite",
    sal: [55000, 70000, "EUR"],
    source: "eFinancialCareers",
    status: "ready",
    score: 83,
    family: "Treasury",
    h: 190,
    critic: [7, "PASS"],
    jd: "Proprietary FX trading firm in Frankfurt: supports the discretionary spot/forwards desk on trade execution, intraday risk monitoring and daily market commentary, with a path to building Python-based analysis tools.",
    jdFull:
      "Quantera is a proprietary trading firm running systematic and discretionary FX strategies out of Frankfurt. Our trading floor is small, fast-paced and performance-driven.\n\nThe Role\nWe're hiring a Junior FX Trader to join our discretionary spot and forwards desk, supporting senior traders on execution, risk monitoring and market analysis.\n\nWhat You'll Do\n- Execute FX spot and forward trades under senior trader supervision\n- Monitor intraday position and risk limits\n- Prepare daily market commentary for the desk\n- Support post-trade reconciliation with operations\n- Build market-analysis tools in Python over time\n\nWhat We're Looking For\n- 0-2 years, ideally with a trading internship or rotational programme\n- Strong quantitative background (finance, economics, engineering, maths)\n- Comfortable under pressure with fast decision-making\n\nWhat We Offer\n- Onsite, our Frankfurt trading floor\n- Base salary plus performance-linked bonus\n- Structured mentorship from senior traders\n- Fast progression track for strong performers\n\nQuantera hires for raw analytical ability and composure under pressure over polished CVs.",
    req: [
      "0-2 years, trading internship or rotational programme a plus",
      "Strong quantitative background (finance, economics, engineering, maths)",
      "Comfortable under pressure with fast decision-making",
      "Basic Python a plus",
      "English fluent, German a plus",
    ],
    pros: [
      "Ottima palestra analitica con mentorship diretta da senior trader",
      "Progressione rapida per profili performanti",
      "Bonus legato alla performance con upside interessante",
    ],
    cons: [
      "Ambito trading discrezionale nuovo rispetto al percorso",
      "Full onsite, ritmi da desk intensi",
    ],
    notes:
      "SENIORITY_JD: junior\nEXPERIENCE_REQUIRED: 0-2 anni\nEXPERIENCE_TYPE: preferred\nDEGREE: required (materia quantitativa)\nLANGUAGE_REQUIRED: Inglese, Tedesco plus\n\nRuolo di trading junior full onsite su desk FX discrezionale, ambito diverso dal percorso finance/risk del candidato ma con forte enfasi su capacità analitiche quantitative trasferibili. Azienda con reputazione buona tra i trader (Glassdoor 4.2) ma ritmi noti come intensi.\nNOTE_MISMATCH: [DOMAIN] Trading discrezionale FX è un ambito nuovo rispetto al background di risk/FP&A del candidato.",
    scoreNotes:
      "Punteggio alto: il profilo quantitativo del candidato è esattamente ciò che l'azienda cerca in un junior trader, nonostante la mancanza di esperienza diretta in trading.",
    criticNotes:
      "Round 1: 6/10, Round 2: 7/10, Round 3: 7/10. Verdict: PASS. Strength: strong quantitative and risk-analysis background clearly evidenced, good fit for the firm's stated hiring criteria of raw analytical ability. Gap: no direct trading experience, CV frames this honestly as transferable analytical skill rather than claiming trading exposure that isn't there.",
    addr: "Neue Mainzer Straße 66-68, 60311 Frankfurt am Main",
  },
  {
    title: "Deal Execution Analyst",
    company: "Vertex Deals",
    city: "munich",
    remote: "full_remote",
    sal: [65000, 80000, "EUR"],
    source: "LinkedIn",
    status: "ready",
    score: 88,
    family: "M&A / Deals",
    h: 198,
    critic: [8, "PASS"],
    jd: "Embedded corp-dev advisory platform for tech/industrial bolt-on acquisitions: runs acquisition modelling and DD coordination across finance/legal/commercial workstreams, drafts board and IC materials, fully remote with occasional client travel.",
    jdFull:
      "Vertex Deals is a corporate development advisory platform helping tech and industrial companies run bolt-on acquisition programmes. We work as an embedded extension of our clients' corp dev teams.\n\nThe Role\nWe're hiring a Deal Execution Analyst to support live acquisition processes for our clients, from initial screening through to closing, working fully remote with occasional client travel.\n\nWhat You'll Do\n- Build acquisition models and support valuation discussions\n- Coordinate due diligence across finance, legal and commercial workstreams\n- Draft board papers and investment committee materials for clients\n- Track deal pipeline and support post-merger integration handover\n- Liaise with external advisors (legal, tax, financial DD)\n\nWhat We're Looking For\n- 3-5 years in M&A, transaction services or corporate development\n- Strong financial modelling and DD-coordination experience\n- Comfortable working across multiple client mandates remotely\n\nWhat We Offer\n- Fully remote, occasional travel to client sites (roughly monthly)\n- Competitive salary with deal-based bonus\n- Direct exposure to client corp dev leadership\n- Small team with fast decision-making\n\nVertex Deals is a lean team and every analyst runs real deal responsibility.",
    req: [
      "3-5 years in M&A, transaction services or corporate development",
      "Strong financial modelling and due-diligence coordination",
      "Comfortable managing multiple client mandates remotely",
      "Experience drafting board/IC materials",
      "English fluent, German a plus",
    ],
    pros: [
      "Full remote con responsabilità dirette su deal reali",
      "Esposizione a leadership corp dev di clienti industriali",
      "Bonus deal-based con buon upside",
    ],
    cons: ["Trasferte mensili richieste nonostante il remote"],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 3-5 anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: Inglese, Tedesco plus\n\nRuolo di deal execution full remote con responsabilità dirette su mandati M&A per clienti industriali e tech, ottimo allineamento con l'esperienza del candidato in valuation e due diligence. Modello di lavoro simile a posizioni analoghe già valutate positivamente.\nNOTE_MISMATCH: [GEO] Richiesta disponibilità a trasferte mensili presso i clienti, parzialmente in contrasto con la preferenza per il full remote.",
    scoreNotes:
      "Punteggio alto: fit tecnico eccellente su modellazione e due diligence, lieve riserva sulla componente di trasferte periodiche.",
    criticNotes:
      "Round 1: 7/10, Round 2: 8/10, Round 3: 8/10. Verdict: PASS. Strength: due-diligence coordination and valuation modelling experience map directly onto the role's core responsibilities, prior deal examples used verbatim from candidate history. Gap: limited direct client-facing corp-dev exposure, CV frames it as advisory-adjacent rather than overstating it.",
  },
  {
    title: "Senior FP&A Manager",
    company: "Lexio AI",
    city: "berlin",
    remote: "hybrid",
    sal: [78000, 95000, "EUR"],
    source: "LinkedIn",
    status: "ready",
    score: 91,
    family: "FP&A",
    h: 206,
    critic: [9, "PASS"],
    jd: "AI contract-review scale-up past 150 employees: owns the company-wide driver-based operating model, leads annual/quarterly planning and acts as finance business partner to Sales, R&D and G&A leads, reporting into the CFO.",
    jdFull:
      "Lexio AI builds AI-powered contract-review tools for legal and procurement teams. As we scale past 150 employees, our finance function is professionalising and this role is central to that.\n\nThe Role\nWe're hiring a Senior FP&A Manager to own the company-wide forecasting model, lead the annual planning cycle and act as the primary finance business partner to department heads.\n\nWhat You'll Do\n- Own the driver-based operating model across all departments\n- Lead annual budgeting and quarterly reforecast cycles\n- Business-partner with Sales, R&D and G&A leads on their budgets\n- Prepare the monthly board reporting pack with the CFO\n- Build the case for headcount and investment decisions\n\nWhat We're Looking For\n- 6+ years in FP&A, ideally in a scaling tech company\n- Strong stakeholder-management and modelling skills\n- Comfortable presenting directly to the CFO and board\n\nWhat We Offer\n- Hybrid, 2 days/week in our Berlin office\n- Competitive salary plus meaningful equity\n- Direct line to the CFO\n- High-impact role in a fast-scaling AI company\n\nLexio AI has doubled headcount in the last 12 months and this role will help keep finance a step ahead of that growth.",
    req: [
      "6+ years in FP&A, scaling tech company experience preferred",
      "Strong stakeholder management and modelling skills",
      "Comfortable presenting to CFO and board",
      "Experience owning company-wide forecasting models",
      "English fluent, German a plus",
    ],
    pros: [
      "Ottimo allineamento di seniority ed esperienza",
      "Business partnering diretto con CFO e board",
      "Azienda in crescita rapida con reputazione solida",
    ],
    cons: ["Range salariale non pubblicato, da negoziare"],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 6+ anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: Inglese, Tedesco plus\n\nRuolo di FP&A senior in una scale-up AI in forte crescita, ottimo allineamento con il percorso e la seniority del candidato. Reputazione aziendale solida (Glassdoor 4.4) e ruolo con visibilità diretta sul board.\nNOTE_MISMATCH: [SALARY] Range non specificato pubblicamente, da verificare in fase di negoziazione rispetto al target dichiarato.",
    scoreNotes:
      "Punteggio molto alto: fit quasi ideale su seniority, competenze di modellazione e contesto aziendale in crescita, senza criticità rilevanti oltre alla trasparenza salariale.",
    criticNotes:
      "Round 1: 8/10, Round 2: 9/10, Round 3: 9/10. Verdict: PASS. Strength: forecasting ownership and CFO-facing reporting experience map closely to the role, business-partnering examples from prior roles used directly without embellishment. Gap: none material identified; minor note that equity-heavy comp structure should be flagged during negotiation.",
  },
  {
    title: "Audit Senior",
    company: "Databridge",
    city: "madrid",
    remote: "hybrid",
    sal: [62000, 78000, "EUR"],
    source: "LinkedIn",
    status: "ready",
    score: 85,
    family: "Risk & Audit",
    h: 214,
    critic: [7, "PASS"],
    jd: "Data-infrastructure company serving financial institutions: leads internal audit engagements across finance, operations and technology, drafts actionable findings for management and supports SOC 2/ISO 27001 audit readiness.",
    jdFull:
      "Databridge is a data-infrastructure company serving financial institutions across Southern Europe. Our internal audit function reports directly to the Audit Committee and covers both financial and operational risk.\n\nThe Role\nWe're hiring an Audit Senior to lead internal audit engagements across our finance, operations and technology functions, working closely with the Head of Internal Audit.\n\nWhat You'll Do\n- Lead internal audit engagements from planning through to reporting\n- Test financial and operational controls against the annual audit plan\n- Draft clear, actionable audit findings for management\n- Track remediation of prior audit findings\n- Support SOC 2 and ISO 27001 audit readiness work\n\nWhat We're Looking For\n- 4-6 years in internal or external audit\n- Experience with financial and IT general controls\n- Comfortable leading engagements with limited supervision\n\nWhat We Offer\n- Hybrid, 2 days/week in our Madrid office\n- Direct reporting line to the Head of Internal Audit\n- Exposure to the Audit Committee\n- Structured path to Audit Manager\n\nDatabridge treats internal audit as a strategic function supporting its expansion into regulated financial-services clients.",
    req: [
      "4-6 years in internal or external audit",
      "Experience with financial and IT general controls",
      "Comfortable leading engagements with limited supervision",
      "SOC 2/ISO 27001 audit exposure a plus",
      "Spanish and English fluent",
    ],
    pros: [
      "Funzione audit strategica con riporto all'Audit Committee",
      "Percorso chiaro verso Audit Manager",
      "Esposizione a controlli IT e SOC 2/ISO 27001",
    ],
    cons: ["Spagnolo fluente richiesto, gap linguistico parziale"],
    notes:
      "SENIORITY_JD: senior\nEXPERIENCE_REQUIRED: 4-6 anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: preferred\nLANGUAGE_REQUIRED: Spagnolo + Inglese\n\nRuolo di audit senior in un'azienda di infrastrutture dati per il settore finanziario, buon allineamento con l'esperienza di risk & audit del candidato. Reputazione aziendale positiva (Glassdoor 4.1) e funzione audit con riporto diretto all'Audit Committee.\nNOTE_MISMATCH: [LANGUAGE] Spagnolo fluente richiesto per l'operatività locale, il candidato ha solo inglese professionale.",
    scoreNotes:
      "Punteggio alto: solido fit tecnico su internal audit e controlli, con una riserva minore sul requisito linguistico locale non pienamente coperto.",
    criticNotes:
      "Round 1: 7/10, Round 2: 7/10, Round 3: 8/10. Verdict: PASS. Strength: internal audit and controls-testing experience directly evidenced, IFRS 9 and provisioning work from prior roles cited as relevant precedent. Gap: Spanish fluency not confirmed in CV, flagged transparently rather than assumed.",
  },
  {
    title: "Bookkeeper",
    company: "GreenGrid",
    city: "amsterdam",
    remote: "onsite",
    sal: [30000, 36000, "EUR"],
    source: "Indeed",
    status: "applied",
    score: 77,
    family: "Accounting",
    h: 230,
    critic: [6, "PASS"],
    jd: "Smart-grid software company scaling across European markets: manages day-to-day bookkeeping, expense processing, weekly bank reconciliations and month-end close support for the Amsterdam entity.",
    jdFull:
      "GreenGrid develops smart-grid monitoring software for European utilities. Our small finance team keeps the books clean as we scale across multiple markets.\n\nThe Role\nWe're hiring a Bookkeeper to manage day-to-day bookkeeping, expense processing and support the month-end close for our Amsterdam entity.\n\nWhat You'll Do\n- Process supplier invoices and employee expense claims\n- Maintain the general ledger for day-to-day transactions\n- Reconcile bank accounts weekly\n- Support the month-end close checklist\n- Assist with VAT return preparation\n\nWhat We're Looking For\n- 1-3 years in bookkeeping or junior accounting\n- Comfortable with Exact Online or similar accounting software\n- Dutch and English fluent\n\nWhat We Offer\n- Onsite role in our Amsterdam office\n- Friendly, supportive finance team\n- Pension contribution above statutory minimum\n- Growth path into a broader accounting role\n\nGreenGrid is a mission-driven company in the energy-transition space and this role keeps the finance engine running smoothly.",
    req: [
      "1-3 years in bookkeeping or junior accounting",
      "Comfortable with Exact Online or similar accounting software",
      "Dutch and English fluent",
      "Precise and organised with reconciliations",
      "Comfortable with VAT return preparation support",
    ],
    pros: [
      "Ruolo alla portata tecnica immediata",
      "Azienda mission-driven in un settore in crescita",
      "Percorso di crescita verso ruoli accounting più ampi",
    ],
    cons: [
      "Olandese fluente richiesto, gap linguistico",
      "Full onsite senza flessibilità",
    ],
    notes:
      "SENIORITY_JD: junior\nEXPERIENCE_REQUIRED: 1-3 anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Olandese + Inglese\n\nRuolo di bookkeeping entry-level in un'azienda mission-driven nell'energy transition, coerente con le basi di accounting del candidato. L'olandese fluente richiesto è un vincolo non pienamente coperto ma il ruolo resta alla portata tecnica.\nNOTE_MISMATCH: [LANGUAGE] Olandese fluente richiesto per l'operatività quotidiana, il candidato ha solo inglese.",
    scoreNotes:
      "Punteggio buono per un ruolo entry-level ben alla portata delle competenze di base, con una riserva sul requisito linguistico locale.",
    criticNotes:
      "Round 1: 6/10, Round 2: 6/10. Verdict: PASS. Strength: basic bookkeeping and reconciliation experience clearly evidenced, low-risk fit for an entry-level role. Gap: Dutch fluency not present in CV, addressed honestly rather than claimed.",
    addr: "Herengracht 182, 1016 BR Amsterdam",
  },
  {
    title: "Financial Planning Associate",
    company: "Harborline",
    city: "tallinn",
    remote: "full_remote",
    sal: [45000, 58000, "EUR"],
    source: "Wellfound",
    status: "applied",
    score: 82,
    family: "FP&A",
    h: 245,
    critic: [7, "PASS"],
    jd: "Baltic/Nordic digital wealth-management platform, Series A: maintains the company operating model and monthly reforecast, builds variance analysis for department heads and supports CFO investor reporting, fully remote.",
    jdFull:
      "Harborline is a digital wealth-management platform serving retail investors across the Baltics and Nordics. Our finance team runs fully remote with a quarterly in-person gathering.\n\nThe Role\nWe're hiring a Financial Planning Associate to support our internal financial planning cycle, building the operating model and supporting monthly reforecasts.\n\nWhat You'll Do\n- Maintain the company operating model and monthly reforecast\n- Prepare variance analysis against budget for department heads\n- Support the CFO with investor reporting materials\n- Build ad hoc analysis on customer acquisition cost and retention\n- Help streamline the planning process as the company scales\n\nWhat We're Looking For\n- 2-4 years in FP&A or financial planning\n- Strong Excel/Google Sheets modelling skills\n- Comfortable working fully remote and asynchronously\n\nWhat We Offer\n- Fully remote across the EU\n- Quarterly in-person team gathering (travel covered)\n- Home office stipend\n- Equity package\n\nHarborline is a Series A company and this role will grow into broader FP&A ownership as the team scales.",
    req: [
      "2-4 years in FP&A or financial planning",
      "Strong Excel/Google Sheets modelling skills",
      "Comfortable working fully remote and asynchronously",
      "Experience with variance analysis and reforecasting",
      "English fluent",
    ],
    pros: [
      "Full remote EU senza vincoli geografici",
      "Ruolo con margine di crescita verso FP&A ownership più ampia",
      "Buon allineamento tecnico su modellazione e forecast",
    ],
    cons: ["Range salariale non pubblicato"],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 2-4 anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Inglese\n\nRuolo di financial planning full remote in una fintech Series A, buon allineamento con l'esperienza di modellazione e forecast del candidato. Nessuna barriera geografica o linguistica rilevante.\nNOTE_MISMATCH: [SALARY] Range non indicato nell'annuncio, da chiarire in colloquio.",
    scoreNotes:
      "Punteggio alto: fit tecnico solido su modellazione e reforecast in un contesto fintech in crescita, con la sola incertezza sulla fascia salariale da chiarire in colloquio.",
    criticNotes:
      "Round 1: 7/10, Round 2: 7/10, Round 3: 8/10. Verdict: PASS. Strength: operating-model ownership and variance-analysis experience map well onto the role, forecasting examples pulled directly from candidate history. Gap: no material gap identified, salary range flagged as open question for the interview.",
  },
  {
    title: "Sales Development Rep, Fintech",
    company: "MarketNest",
    city: "valencia",
    remote: "full_remote",
    sal: [28000, 38000, "EUR"],
    source: "LinkedIn",
    status: "response",
    score: 80,
    family: "Sales",
    h: 260,
    critic: [7, "PASS"],
    jd: "Embedded-lending infrastructure vendor for e-commerce, remote-first sales team based around Valencia: runs outbound prospecting and lead qualification to book meetings for the Account Executive team, with a defined AE promotion path.",
    jdFull:
      "MarketNest sells embedded-lending infrastructure to e-commerce platforms across Southern Europe. Our sales team is remote-first with a hub in Valencia for occasional team gatherings.\n\nThe Role\nWe're hiring a Sales Development Representative to generate and qualify pipeline for our Account Executive team, focused on mid-market e-commerce platforms.\n\nWhat You'll Do\n- Run outbound prospecting campaigns via email, LinkedIn and calls\n- Qualify inbound leads against our ideal-customer profile\n- Book qualified meetings for the Account Executive team\n- Maintain accurate pipeline data in HubSpot\n- Collaborate with marketing on campaign feedback\n\nWhat We're Looking For\n- 1-3 years in SDR/BDR role, fintech or B2B SaaS a plus\n- Comfortable with high-volume outbound activity\n- Strong written and verbal communication in English and Spanish\n\nWhat We Offer\n- Fully remote, occasional gatherings in Valencia\n- Base salary plus uncapped commission\n- Clear promotion path to Account Executive\n- Sales training and coaching programme\n\nMarketNest is scaling its outbound motion aggressively this year and this role is central to that growth.",
    req: [
      "1-3 years in SDR/BDR, fintech or B2B SaaS a plus",
      "Comfortable with high-volume outbound prospecting",
      "Strong written and verbal English and Spanish",
      "Experience with HubSpot or similar CRM",
      "Resilient, target-driven mindset",
    ],
    pros: [
      "Provvigioni uncapped con buon potenziale economico",
      "Percorso di crescita chiaro verso Account Executive",
      "Full remote con gathering occasionali",
    ],
    cons: [
      "Dominio commerciale outbound distante dal percorso analitico del candidato",
      "Attività ad alto volume di prospezione, ritmo diverso da ruoli analitici",
    ],
    notes:
      "SENIORITY_JD: mid\nEXPERIENCE_REQUIRED: 1-3 anni\nEXPERIENCE_TYPE: mandatory\nDEGREE: not required\nLANGUAGE_REQUIRED: Inglese + Spagnolo\n\nRuolo commerciale full remote in una fintech B2B in crescita, fuori dal percorso finance/analisi tradizionale del candidato ma con overlap su comunicazione strutturata e orientamento ai target. Provvigioni uncapped come elemento di attrattività economica.\nNOTE_MISMATCH: [DOMAIN] Ruolo di prospezione commerciale outbound, dominio distante dal percorso analitico/finance del candidato.",
    scoreNotes:
      "Punteggio buono nonostante il cambio di dominio: le competenze di comunicazione e la determinazione del candidato emergono come trasferibili, pur trattandosi di un ruolo commerciale puro.",
    criticNotes:
      "Round 1: 6/10, Round 2: 7/10, Round 3: 7/10. Verdict: PASS. Strength: strong written communication and structured outreach examples adapted from analytical project work, resilience under target pressure evidenced from prior roles. Gap: no direct SDR/outbound sales experience, CV frames transferable skills honestly rather than inventing a sales track record.",
  },
  {
    title: "Account Executive, Insurance Sales",
    company: "Clearpath Insurance",
    city: "roma",
    remote: "onsite",
    sal: [15000, 20000, "EUR"],
    source: "Indeed",
    status: "excluded",
    score: 24,
    family: "Sales",
    h: 320,
    jd: "Traditional insurance brokerage in Rome: builds an insurance client portfolio via door-to-door and in-person prospecting, with daily in-office briefings and commission-heavy sales targets, own vehicle required.",
    jdFull:
      "Clearpath Insurance is a traditional insurance brokerage serving households and small businesses across the Lazio region, with a network of local agents.\n\nThe Role\nWe are hiring an Account Executive to build and manage a portfolio of individual and small-business insurance clients through door-to-door and in-person prospecting across Rome and surrounding areas.\n\nWhat You'll Do\n- Prospect new clients through door-to-door visits and local events\n- Present and sell life, home and business insurance policies\n- Manage renewals and cross-sell additional coverage to existing clients\n- Attend daily in-person team briefings at our Rome office\n- Meet weekly and monthly new-policy targets\n\nWhat We're Looking For\n- Previous experience in direct/door-to-door sales, insurance a plus\n- Comfortable with commission-heavy compensation structure\n- Own vehicle required for client visits\n- Resilient, target-driven personality\n\nWhat We Offer\n- Base salary plus uncapped commission\n- Company car allowance after 6 months\n- In-house sales training programme\n- Daily in-person coaching from the sales manager\n\nClearpath Insurance offers a structured path for driven salespeople willing to build their own client book from scratch.",
    cons: [
      "Ruolo completamente estraneo al percorso professionale del candidato",
      "Retribuzione fissa minima con forte dipendenza dalle commissioni",
    ],
    notes:
      "EXCLUDED: [DOMAIN] Ruolo di vendita porta a porta assicurativa, completamente estraneo al profilo finance/analytics del candidato, coerente con analoga esclusione già registrata per un ruolo simile nel settore assicurativo. Retribuzione fissa minima e struttura fortemente commission-based non compatibile con gli obiettivi economici dichiarati.",
    scoreNotes:
      "Punteggio molto basso: nessuna sovrapposizione con competenze finance/analytics, ruolo di vendita diretta porta a porta incompatibile con il profilo e gli obiettivi di carriera del candidato.",
  },
];
