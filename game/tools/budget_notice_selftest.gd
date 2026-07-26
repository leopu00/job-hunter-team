extends SceneTree
## L'avviso "il team ha esaurito la finestra" deve comparire quando serve e,
## soprattutto, NON comparire quando non serve: una fascia perenne è rumore,
## e l'utente smette di leggerla proprio il giorno in cui conta.
##
## Il tempo è passato esplicitamente: un test che dipende dall'orologio di
## sistema passa o fallisce a seconda di quando lo si esegue.

const ORA := 1785000000.0


func _init() -> void:
	var fails: Array[String] = []

	var casi := [
		# [descrizione, finestra, livello atteso, minuti attesi]
		["finestra comoda → nessun avviso",
			{"usage_pct": 42.0, "reset_at_unix": ORA + 3600.0},
			BudgetWindow.LEVEL_NONE, -1],
		["esaurita → avviso pieno, 40 minuti al ritorno",
			{"usage_pct": 100.0, "reset_at_unix": ORA + 2400.0},
			BudgetWindow.LEVEL_FULL, 40],
		["vicina al limite → avviso attenuato",
			{"usage_pct": 93.0, "reset_at_unix": ORA + 1800.0},
			BudgetWindow.LEVEL_NEAR, 30],
		["reset già passato → tacere, il blocco è finito",
			{"usage_pct": 100.0, "reset_at_unix": ORA - 60.0},
			BudgetWindow.LEVEL_NONE, -1],
		["nessun dato → tacere (il gioco parte prima del primo campione)",
			{}, BudgetWindow.LEVEL_NONE, -1],
		["campione senza usage → tacere",
			{"reset_at_unix": ORA + 600.0}, BudgetWindow.LEVEL_NONE, -1],
		["99% al minuto del reset → è l'obiettivo centrato, non un allarme",
			{"usage_pct": 99.6, "reset_at_unix": ORA + 30.0},
			BudgetWindow.LEVEL_FULL, 1],
	]

	for caso in casi:
		var stato := BudgetWindow.state_for(caso[1], ORA)
		if str(stato["level"]) != str(caso[2]):
			fails.append("%s — livello %s invece di %s"
					% [caso[0], stato["level"], caso[2]])
		elif int(stato["minutes"]) != int(caso[3]):
			fails.append("%s — %d minuti invece di %d"
					% [caso[0], stato["minutes"], caso[3]])

	# Il consumo va riportato all'utente: senza, l'avviso "vicino al limite"
	# non dice quanto vicino.
	var vicina := BudgetWindow.state_for(
			{"usage_pct": 93.0, "reset_at_unix": ORA + 600.0}, ORA)
	if int(vicina["usage"]) != 93:
		fails.append("il consumo non viene riportato: %s" % vicina)

	if fails.is_empty():
		print("BUDGET-NOTICE-TEST PASS")
		quit(0)
	else:
		print("BUDGET-NOTICE-TEST FAIL ", fails)
		quit(1)
