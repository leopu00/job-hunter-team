class_name PositionSearch
extends RefCounted
## Cosa vuol dire "cercare una posizione", nel gioco (O-60).
##
## Gemella di `web/lib/position-search.ts`: le due superfici devono rispondere
## la stessa cosa alla stessa domanda, e per farlo la regola deve stare in un
## posto solo per ciascuna — non sparsa dentro la UI.
##
## Vive fuori da `global_search.gd` anche per un motivo pratico: quel file
## nomina l'autoload BackendBus, e un file che nomina un autoload non si può
## caricare in un selftest headless. La regola qui non dipende da niente, così
## `tools/global_search_selftest.gd` la esegue davvero invece di leggerla.

## L'ID scritto come lo si legge: "JHT-042", "jht 42", "#42", "0042" → 42.
## Nella lista e nell'intestazione l'identificativo compare col prefisso e con
## gli zeri, e chi lo copia se li porta dietro. 0 = la query non è un ID.
static func parse_id(query: String) -> int:
	var re := RegEx.new()
	re.compile("^(?:jht[\\s\\-_#]*|#\\s*)?0*([0-9]{1,9})$")
	var m := re.search(query.strip_edges().to_lower())
	return int(m.get_string(1)) if m != null else 0

## Match case-insensitive su ID, titolo, azienda, città, famiglia e fonte.
## Query vuota = nessun filtro (la lista mostra le prime `limit`).
static func filter(rows: Array, query: String, limit: int) -> Array:
	var out: Array = []
	var q := query.strip_edges().to_lower()
	var wanted_id := parse_id(q)
	for p in rows:
		if q != "":
			# L'ID è un OR in più, non un ramo alternativo: "42" può essere
			# anche un pezzo di titolo, e chi cerca vuole tutti e due i casi.
			var id_hit: bool = wanted_id > 0 and int(p.get("id", 0)) == wanted_id
			var hay := ("%s %s %s %s %s" % [p.get("title", ""), p.get("company", ""),
					p.get("loc_city", ""), p.get("role_family", ""),
					p.get("source", "")]).to_lower()
			if not id_hit and not hay.contains(q):
				continue
		out.append(p)
		if out.size() >= limit:
			break
	return out
