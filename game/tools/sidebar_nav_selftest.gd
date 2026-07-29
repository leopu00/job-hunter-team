extends SceneTree
## Self-test headless della navigazione laterale.
## Esecuzione: godot --headless --path game --script res://tools/sidebar_nav_selftest.gd
##
## La sidebar è passata da ventotto righe a tredici raccogliendo le viste di
## monitoraggio in schede e le pagine di configurazione dietro "Impostazioni".
## Il patto di quel riordino è che NESSUNA sezione sia sparita: è cambiata la
## strada, non la destinazione. Ma "sparita" non fa rumore — la voce semplicemente
## non c'è più in nessun elenco, e nessun test la reclama.
##
## Tre contratti:
##  1. ogni sezione elencata da qualche parte è raggiungibile, cioè `nav_host`
##     la riporta a una riga che esiste davvero in GROUPS;
##  2. nessuna sezione compare in due posti (una riga propria E una famiglia):
##     avrebbe due strade e una sola si accenderebbe;
##  3. ogni voce ha un'etichetta tradotta — senza la chiave "side.<id>" a
##     schermo finisce l'id grezzo ("agent_metrics"), che è successo davvero
##     appena le due liste hanno smesso di coincidere.

var _failures: Array[String] = []


func _init() -> void:
	var rows: Array[String] = []
	for group in SidebarDefs.GROUPS:
		for item in group["items"]:
			rows.append(str(item["id"]))
	_check("righe in sidebar", rows.size() > 0, "GROUPS è vuoto")

	# 1 + 2: ogni sezione nascosta ha una e una sola riga che la ospita
	var hidden: Array[String] = []
	hidden.append_array(SidebarDefs.MONITOR_SECTIONS)
	for group in SidebarDefs.SETTINGS_GROUPS:
		for item in group["items"]:
			hidden.append(str(item["id"]))
	for section in hidden:
		var host := SidebarDefs.nav_host(section)
		_check("sezione raggiungibile: " + section, rows.has(host),
				"nav_host() la manda su '%s', che in sidebar non esiste" % host)
	for section in hidden:
		# la PRIMA sezione di una famiglia è anche la riga: è l'unico caso
		# legittimo in cui un id sta in entrambe le liste
		if rows.has(section) and SidebarDefs.nav_host(section) != section:
			_failures.append("%s ha una riga propria E un contenitore" % section)

	# 3: niente id grezzi a schermo
	for group in SidebarDefs.GROUPS:
		for item in group["items"]:
			var id := str(item["id"])
			_check("etichetta riga: " + id,
					SidebarDefs.nav_label(item) != id,
					"manca la chiave i18n della riga")
	for section in hidden:
		_check("etichetta sezione: " + section,
				SidebarDefs.label_for(section) != section,
				"manca la chiave i18n 'side.%s'" % section)
	for group in SidebarDefs.SETTINGS_GROUPS:
		var key := str(group["key"])
		_check("titolo gruppo impostazioni: " + key,
				UIStrings.t(key) != key, "chiave i18n assente")

	if _failures.is_empty():
		print("SIDEBAR-NAV-TEST PASS (%d righe, %d sezioni ospitate)"
				% [rows.size(), hidden.size()])
		quit(0)
		return
	for failure in _failures:
		push_error("[sidebar-nav-test] " + failure)
	print("SIDEBAR-NAV-TEST FAIL (%d problemi)" % _failures.size())
	quit(1)


func _check(name: String, condition: bool, detail: String = "") -> void:
	if not condition:
		_failures.append("%s — %s" % [name, detail])
