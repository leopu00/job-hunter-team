extends Node
## Autoload `TeamData`: espone la sorgente dati attiva al resto del gioco.
## Per agganciare il backend reale basta sostituire qui l'implementazione.

var source: TeamDataSource = MockDataSource.new()

func summary() -> Dictionary:
	return source.get_team_summary()

func positions_today() -> Array:
	return source.get_positions_today()

func agent_status() -> Dictionary:
	return source.get_agent_status()

func score_explanation() -> Dictionary:
	return source.get_score_explanation()

func mentor_tip() -> String:
	return source.get_mentor_tip()

func applications() -> Array:
	return source.get_applications()

func streak() -> Dictionary:
	return source.get_streak()
