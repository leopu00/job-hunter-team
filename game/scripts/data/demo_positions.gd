class_name DemoPositions
## Catalogo puramente fittizio per il primo avvio. Non contiene dati utente,
## aziende reali o link attivi: serve a far capire lista, filtri, scheda e mappa
## prima che il provider sia collegato. Gli id negativi non possono collidere
## con quelli autoincrementali del jobs.db reale.

const ROLES := [
	["Infermiere di comunità", "Healthcare"],
	["Coordinatrice di servizi clinici", "Healthcare"],
	["Tecnico di laboratorio ambientale", "Science / Laboratory"],
	["Docente di matematica", "Education"],
	["Learning Experience Designer", "Education"],
	["Bibliotecario digitale", "Culture / Information"],
	["Analista finanziario", "Finance"],
	["Consulente assicurativo", "Finance"],
	["Specialista paghe", "People / HR"],
	["Talent Acquisition Partner", "People / HR"],
	["People Operations Specialist", "People / HR"],
	["Account Executive", "Sales"],
	["Sales Development Representative", "Sales"],
	["Customer Success Manager", "Customer Success"],
	["Customer Support Specialist", "Customer Success"],
	["Marketing Campaign Manager", "Marketing"],
	["Content Strategist", "Marketing"],
	["Social Media Editor", "Marketing"],
	["Event Producer", "Events"],
	["Operations Manager", "Operations"],
	["Supply Chain Planner", "Operations"],
	["Procurement Specialist", "Operations"],
	["Responsabile di struttura ricettiva", "Hospitality"],
	["Travel Experience Coordinator", "Hospitality"],
	["Chef di produzione", "Hospitality"],
	["Sustainability Analyst", "Sustainability"],
	["Energy Community Coordinator", "Sustainability"],
	["Compliance Specialist", "Legal / Compliance"],
	["Privacy Operations Analyst", "Legal / Compliance"],
	["Paralegal", "Legal / Compliance"],
	["Product Designer", "Design / Research"],
	["Service Designer", "Design / Research"],
	["UX Researcher", "Design / Research"],
	["Visual Designer", "Design / Research"],
	["Project Manager", "Project Management"],
	["Program Coordinator", "Project Management"],
	["Construction Site Coordinator", "Engineering / Trades"],
	["Tecnico manutentore", "Engineering / Trades"],
	["Ingegnere energetico", "Engineering / Trades"],
	["Frontend Developer", "Software Engineering"],
	["Backend Developer", "Software Engineering"],
	["QA Automation Engineer", "QA / Test"],
	["Cloud Platform Engineer", "Platform / Infrastructure"],
	["Cybersecurity Analyst", "Security"],
	["Data Analyst", "Data / BI"],
	["Data Engineer", "Data / BI"],
	["Machine Learning Engineer", "AI / ML"],
	["AI Product Specialist", "AI / ML"],
	["Technical Writer", "Developer Relations"],
	["Community Manager", "Community"],
]

const COMPANIES := [
	"Aurora Commons", "Blue Finch Cooperative", "Cedar & Stone", "Dandelion Labs",
	"Ember District", "Fable Works", "Green Harbor", "Hearthline Collective",
	"Indigo Railway", "Juniper House", "Kindred Systems", "Lighthouse Studio",
	"Mosaic Field", "Northwind Guild", "Olive Branch Network", "Paper Kite Group",
	"Quiet River", "Redwood Circle", "Sunbeam Works", "Tidepool Partners",
]

const LOCATIONS := [
	["Milano", "Italy", 45.4642, 9.1900], ["Roma", "Italy", 41.9028, 12.4964],
	["Torino", "Italy", 45.0703, 7.6869], ["Bologna", "Italy", 44.4949, 11.3426],
	["Firenze", "Italy", 43.7696, 11.2558], ["Napoli", "Italy", 40.8518, 14.2681],
	["Berlin", "Germany", 52.5200, 13.4050], ["Hamburg", "Germany", 53.5511, 9.9937],
	["Paris", "France", 48.8566, 2.3522], ["Lyon", "France", 45.7640, 4.8357],
	["Madrid", "Spain", 40.4168, -3.7038], ["Barcelona", "Spain", 41.3874, 2.1686],
	["Lisbon", "Portugal", 38.7223, -9.1393], ["Amsterdam", "Netherlands", 52.3676, 4.9041],
	["Brussels", "Belgium", 50.8503, 4.3517], ["Copenhagen", "Denmark", 55.6761, 12.5683],
	["Stockholm", "Sweden", 59.3293, 18.0686], ["Helsinki", "Finland", 60.1699, 24.9384],
	["Dublin", "Ireland", 53.3498, -6.2603], ["Prague", "Czechia", 50.0755, 14.4378],
	["Warsaw", "Poland", 52.2297, 21.0122], ["Vienna", "Austria", 48.2082, 16.3738],
	["Athens", "Greece", 37.9838, 23.7275], ["Montreal", "Canada", 45.5019, -73.5674],
	["San Francisco", "United States", 37.7749, -122.4194],
]

static func build() -> Array:
	var out: Array = []
	var demo_date := Time.get_date_string_from_system(true)
	for i in ROLES.size():
		var role: Array = ROLES[i]
		var loc: Array = LOCATIONS[(i * 7 + i / 8) % LOCATIONS.size()]
		var mode: String = ["remote", "hybrid", "onsite"][i % 3]
		var score := 52 + (i * 7) % 43
		var salary_min := 28000 + (i % 10) * 3500
		var salary_max := salary_min + 12000 + (i % 4) * 2500
		var status: String = ["new", "checked", "scored", "ready"][i % 4]
		var title := str(role[0])
		var company := str(COMPANIES[i % COMPANIES.size()])
		var city := str(loc[0])
		var family := str(role[1])
		out.append({
			"id": -(i + 1), "title": title, "company": company,
			"status": status, "role_family": family,
			"loc_city": city, "loc_country": str(loc[1]),
			"office_lat": float(loc[2]), "office_lon": float(loc[3]),
			"work_mode": mode, "source": "JHT Demo", "url": "",
			"is_open": 1, "found_at": demo_date + "T09:00:00Z",
			"found_by": "showroom", "salary_declared_min": salary_min,
			"salary_declared_max": salary_max, "salary_declared_currency": "EUR",
			"salary_period": "year", "total_score": score,
			"stack_match": roundi(score * 0.40), "remote_fit": roundi(score * 0.25),
			"salary_fit": roundi(score * 0.20), "experience_fit": roundi(score * 0.10),
			"strategic_fit": roundi(score * 0.15), "scored_by": "showroom",
			"score_notes": UIStrings.t("dept.demo.score_notes"),
			"jd_summary": UIStrings.t("dept.demo.jd_summary") % [company, title, city],
			"highlights": [
				{"type": "pro", "text": UIStrings.t("dept.demo.highlight.collaboration")},
				{"type": "match", "text": UIStrings.t("dept.demo.highlight.growth")},
				{"type": "info", "text": UIStrings.t("dept.demo.highlight.work_mode") % mode},
			],
			"tickets": [], "demo": true,
		})
	return out
