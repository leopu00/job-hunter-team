extends DepartmentDressing
## Veste dei reparti con targhe in INGLESE, solo per le riprese del video di
## presentazione (tools/promo_director.gd). Le targhe di DepartmentDressing
## sono ancora hardcoded in italiano dentro DepartmentDefs: qui si ridisegna
## la stessa identica veste (tinta, usura, brackets) doppiando nome e
## tagline. Il gioco vero non cambia. Deve inoltre restare il fondale del
## reparto: il World y-sortato (agenti e arredi) gli passa davanti.

const BACKDROP_Z_INDEX := -2

const EN := {
	"scout": ["Research", "They scout the web for openings for you"],
	"analisti": ["Analysis", "They study every opening in detail"],
	"scorer": ["Compatibility", "They gauge how well each job fits you"],
	"scrittori": ["Applications", "They tailor CVs and cover letters"],
	"critici": ["Quality control", "They re-read everything before delivery"],
}


func _init() -> void:
	super()
	# DepartmentDressing riceve questo valore da Office._ready(). Durante il
	# doppiaggio promo nasce invece un Node2D nuovo: senza ripristinarlo, le
	# scritte inglesi finiscono a z=0 e possono coprire un agente in cammino.
	z_index = BACKDROP_Z_INDEX


func _draw() -> void:
	for dept_id in DepartmentDefs.DEPT_ORDER:
		var dept: Dictionary = DepartmentDefs.DEPARTMENTS[dept_id]
		var names: Array = EN.get(dept_id, [dept["name"], dept["tagline"]])
		_draw_zone(dept_id, dept["zone"], dept["color"],
				str(names[0]), str(names[1]))
