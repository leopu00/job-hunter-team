extends DepartmentDressing
## Veste dei reparti con targhe in INGLESE, solo per le riprese del video di
## presentazione (tools/promo_director.gd). Le targhe di DepartmentDressing
## sono ancora hardcoded in italiano dentro DepartmentDefs: qui si ridisegna
## la stessa identica veste (tinta, usura, brackets) doppiando nome e
## tagline. Il gioco vero non cambia.

const EN := {
	"scout": ["Research", "They scout the web for openings for you"],
	"analisti": ["Analysis", "They study every opening in detail"],
	"scorer": ["Compatibility", "They gauge how well each job fits you"],
	"scrittori": ["Applications", "They tailor CVs and cover letters"],
	"critici": ["Quality control", "They re-read everything before delivery"],
}


func _draw() -> void:
	for dept_id in DepartmentDefs.DEPT_ORDER:
		var dept: Dictionary = DepartmentDefs.DEPARTMENTS[dept_id]
		var names: Array = EN.get(dept_id, [dept["name"], dept["tagline"]])
		_draw_zone(dept_id, dept["zone"], dept["color"],
				str(names[0]), str(names[1]))
