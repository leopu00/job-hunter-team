extends SceneTree
## Self-test del rilevamento Docker del probe di setup.
## Esecuzione: godot --headless --path game --script res://tools/docker_probe_selftest.gd
##
## Il contratto sotto esame: assente / installato ma spento / attivo sono TRE
## stati e tre schermate diverse (installa · avvia il motore · procedi). Il
## vecchio criterio `OS.execute(...) != -1` li faceva collassare su POSIX: un
## docker assente esce 127 attraverso la shell (misurato su macOS, Godot 4.7 —
## mai -1), quindi `docker_available` restava true e INSTALLA DOCKER, l'unica
## azione utile per chi arriva senza motore, non compariva mai.
##
## Come pull_stream_selftest, su POSIX si prova PER DAVVERO con finti `docker`
## nel PATH: uno che manca, uno che risponde col daemon spento (l'errore vero
## di docker), uno che risponde col daemon acceso, e uno che esce 127 — il
## codice ambiguo che un criterio a soli numeri leggerebbe come "assente".
##
## O-13 (setup macOS, difetto d'uso trovato dall'operatore) ha aggiunto un
## secondo contratto allo stesso probe: quali MOTORI ci sono, che è un'altra
## domanda rispetto a "c'è il client docker". Un'app aperta dal Finder eredita
## il PATH minimo di launchd e non vede /opt/homebrew/bin: sulla macchina
## dell'operatore `colima` girava, ma l'app non lo trovava e offriva INSTALLA
## DOCKER. Le sezioni nuove coprono le tre schermate che ne dipendono —
## «runtime assente», «solo Colima», «due motori, scelta dell'utente» — e per
## poterlo fare azzerano `extra_bin_dirs`: con le cartelle vere, su una
## macchina di sviluppo il caso «assente» non esisterebbe più.

var _fails: Array[String] = []
## Caricato in _run, MAI come inizializzatore di membro: lo script principale
## viene istanziato prima che gli autoload esistano, e setup_service.gd non
## compila senza (e la sua load fallita resterebbe in cache anche per loro).
var _svc_script: GDScript
## Ogni sezione si firma qui alla fine: un errore di script abortisce la
## funzione SENZA passare dai _check, e senza questo contatore il test
## finirebbe verde a asserzioni mai eseguite.
var _sections := 0
var _root_dir := ""
var _old_path := ""
var _old_extra: Array[String] = []


func _check(what: String, ok: bool, detail := "") -> void:
	if not ok:
		_fails.append(what + ("" if detail == "" else " — " + detail))


func _init() -> void:
	create_timer(60.0).timeout.connect(func() -> void:
		print("DOCKER-PROBE-TEST FAIL [timeout]")
		quit(2))
	process_frame.connect(_run, CONNECT_ONE_SHOT)


func _run() -> void:
	_svc_script = load("res://scripts/setup/setup_service.gd")
	_check("setup_service.gd caricabile", _svc_script != null
			and _svc_script.can_instantiate())
	_old_path = OS.get_environment("PATH")
	# Le cartelle aggiuntive sono la RETE per l'app lanciata dal Finder, ma qui
	# renderebbero indistinguibile "PATH senza docker" da "macchina senza
	# docker": si azzerano, e la sezione dedicata le riaccende da sola.
	_old_extra = _svc_script.extra_bin_dirs
	_svc_script.extra_bin_dirs = [] as Array[String]
	_root_dir = OS.get_cache_dir().path_join(
			"jht-docker-probe-selftest-%d" % int(Time.get_ticks_usec()))
	var expected := 4
	_which_contract()
	_exec_present_contract()
	_runtime_selection_contract()
	_podman_adapter_contract()
	if OS.get_name() != "Windows":
		expected += 3
		_probe_three_states()
		_cli_started_team_contract()
		_gui_path_contract()
	OS.set_environment("PATH", _old_path)
	_svc_script.extra_bin_dirs = _old_extra
	_check("tutte le sezioni arrivate in fondo", _sections == expected,
			"%d/%d" % [_sections, expected])
	if _fails.is_empty():
		print("DOCKER-PROBE-TEST PASS")
		quit(0)
	else:
		print("DOCKER-PROBE-TEST FAIL ", _fails)
		quit(1)


func _stub_dir(name: String) -> String:
	var dir := _root_dir.path_join(name)
	DirAccess.make_dir_recursive_absolute(dir)
	return dir


func _write_stub(path: String, body: String, executable := true) -> void:
	var f := FileAccess.open(path, FileAccess.WRITE)
	f.store_string(body)
	f.close()
	if executable and OS.get_name() != "Windows":
		# Percorso assoluto: quando si scrive lo stub successivo il PATH è già
		# quello ridotto del caso precedente, e lì chmod non esiste.
		OS.execute("/bin/chmod", PackedStringArray(["+x", path]))


func _set_path(dirs: PackedStringArray) -> void:
	var sep := ";" if OS.get_name() == "Windows" else ":"
	OS.set_environment("PATH", sep.join(dirs))


## _which: la prova di presenza è il file nel PATH, non un codice d'uscita.
func _which_contract() -> void:
	var exe := "docker.exe" if OS.get_name() == "Windows" else "docker"
	var with_docker := _stub_dir("which-with")
	_write_stub(with_docker.path_join(exe), "#!/bin/sh\nexit 0\n")
	var empty := _stub_dir("which-empty")
	_set_path(PackedStringArray([empty, with_docker]))
	var found := str(_svc_script._which("docker"))
	_check("which: trova il binario nel PATH",
			found == with_docker.path_join(exe), found)
	_set_path(PackedStringArray([empty]))
	_check("which: PATH senza docker → vuoto",
			str(_svc_script._which("docker")) == "")
	if OS.get_name() != "Windows":
		# Un file nel PATH SENZA bit di esecuzione non è un comando: la shell
		# risponderebbe "permission denied" (126), non lo eseguirebbe mai.
		var noexec := _stub_dir("which-noexec")
		_write_stub(noexec.path_join("docker"), "non eseguibile\n", false)
		_set_path(PackedStringArray([noexec]))
		_check("which: file senza +x non conta",
				str(_svc_script._which("docker")) == "")
	_sections += 1


## _exec_present: la rete comportamentale che protegge il ramo Windows.
## Anche a PATH-scan cieco, un processo che ha RISPOSTO (codice suo, non i
## 126/127 della shell né il -1 del lancio fallito) prova che il binario c'è.
func _exec_present_contract() -> void:
	_set_path(PackedStringArray([_stub_dir("which-empty")]))
	_check("present: -1 (lancio fallito, ramo Windows) → assente",
			not bool(_svc_script._exec_present("docker", -1)))
	_check("present: 127 dalla shell senza binario nel PATH → assente",
			not bool(_svc_script._exec_present("docker", 127)))
	_check("present: 126 (trovato ma non eseguibile) → assente",
			not bool(_svc_script._exec_present("docker", 126)))
	_check("present: exit 0 prova la presenza anche a PATH-scan cieco",
			bool(_svc_script._exec_present("docker", 0)))
	_check("present: exit 1 (daemon spento) prova la presenza anche a "
			+ "PATH-scan cieco", bool(_svc_script._exec_present("docker", 1)))
	_sections += 1


## Quale motore accendere, e quando il pulsante deve restare spento. È logica
## pura sui dati del probe: gira su tutti e tre i sistemi.
func _runtime_selection_contract() -> void:
	var colima: String = _svc_script.RUNTIME_COLIMA
	var podman: String = _svc_script.RUNTIME_PODMAN
	var desktop: String = _svc_script.RUNTIME_DOCKER_DESKTOP
	var both := PackedStringArray([colima, desktop])
	var all := PackedStringArray([colima, podman, desktop])
	_check("scelta: nessun motore installato → niente da avviare",
			str(_svc_script.selected_runtime(PackedStringArray(), "")) == "")
	_check("scelta: un solo motore, nessuna domanda da fare",
			str(_svc_script.selected_runtime(PackedStringArray([colima]), ""))
			== colima)
	_check("scelta: con due motori senza preferenza vince l'ordine",
			str(_svc_script.selected_runtime(both, "")) == colima)
	# Il difetto O-13c: con due motori la scelta non veniva MAI chiesta, e
	# l'app decideva per l'utente. Dichiarata, deve essere rispettata.
	_check("scelta: la preferenza dell'utente batte l'ordine",
			str(_svc_script.selected_runtime(both, desktop)) == desktop)
	_check("scelta: Podman opt-in batte Colima senza rimuoverlo",
			str(_svc_script.selected_runtime(all, podman)) == podman)
	# Preferenza per un motore disinstallato: si riparte dal primo disponibile,
	# non si dichiara l'assenza (sarebbe un setup bloccato da una vecchia
	# scelta invisibile).
	_check("scelta: preferenza caduta → primo disponibile, non blocco",
			str(_svc_script.selected_runtime(PackedStringArray([colima]), desktop))
			== colima)
	# `runtime_missing` è ciò che spegne «ATTIVA CONTAINER» (O-13a).
	_check("spegni: senza motori il pulsante non è premibile",
			bool(_svc_script.runtime_missing({"runtimes": PackedStringArray()})))
	_check("spegni: con un motore il pulsante resta premibile",
			not bool(_svc_script.runtime_missing(
					{"runtimes": PackedStringArray([colima])})))
	# In modalità VPS il motore vive dall'altra parte di SSH: l'assenza locale
	# non è un'assenza, e spegnere il pulsante lì sarebbe un difetto nuovo.
	_check("spegni: su VPS il motore locale non c'entra",
			not bool(_svc_script.runtime_missing(
					{"remote": true, "runtimes": PackedStringArray()})))
	# Nessun motore scelto: si dice, non si finge di averne avviato uno.
	var launch: Dictionary = _svc_script._launch_docker_runtime("")
	_check("avvio: senza motore l'esito è un no dichiarato",
			not bool(launch.get("ok", true)))
	_sections += 1


## Podman non è una semplice presenza nel PATH: deve esistere il bundle JHT
## preparato e attestato. Il desktop resta read-only sul runtime host: il
## passaggio fra la famiglia Podman e la famiglia Docker richiede l'installer.
func _podman_adapter_contract() -> void:
	var runtime := _stub_dir("podman-runtime")
	var bin := runtime.path_join("bin")
	DirAccess.make_dir_recursive_absolute(bin)
	var selection := runtime.path_join("container-runtime")
	var machine := runtime.path_join("podman-machine")
	var shim := bin.path_join("docker")
	var manifest := runtime.path_join(".runtime-integrity")
	_write_stub(selection, "podman\n", false)
	_write_stub(machine, "jht-podman\n", false)
	_write_stub(shim, "#!/bin/sh\n# JHT_PODMAN_DOCKER_SHIM=1\nexit 0\n")
	_write_stub(manifest, "\n".join([
		"version=1",
		"container-runtime=" + FileAccess.get_sha256(selection),
		"podman-machine=" + FileAccess.get_sha256(machine),
		"docker-shim=" + FileAccess.get_sha256(shim),
	]) + "\n", false)
	_check("adapter Podman: marker e hash validi → disponibile",
			bool(_svc_script._podman_adapter_ready_at(runtime, bin)))
	_check("Podman solo installato: senza adapter non è selezionabile",
			not (_svc_script._macos_runtime_inventory(
					true, true, false, false) as PackedStringArray).has(
					_svc_script.RUNTIME_PODMAN))
	_check("routing Podman: adapter valido → shim JHT",
			str(_svc_script._macos_container_cli(
					_svc_script.RUNTIME_PODMAN, true, shim, "/real/docker")) == shim)
	_check("routing Podman: adapter invalido → fail closed",
			str(_svc_script._macos_container_cli(
					_svc_script.RUNTIME_PODMAN, false, shim, "/real/docker")) == "")
	_check("routing Colima: lo shim stale viene ignorato",
			str(_svc_script._macos_container_cli(
					_svc_script.RUNTIME_COLIMA, true, shim, "/real/docker"))
					== "/real/docker")

	_check("switch Podman→Colima: richiede installer",
			bool(_svc_script.runtime_switch_requires_installer(
					_svc_script.RUNTIME_PODMAN, _svc_script.RUNTIME_COLIMA)))
	_check("switch Podman→Desktop: richiede installer",
			bool(_svc_script.runtime_switch_requires_installer(
					_svc_script.RUNTIME_PODMAN,
					_svc_script.RUNTIME_DOCKER_DESKTOP)))
	_check("switch Colima→Desktop: resta una preferenza desktop",
			not bool(_svc_script.runtime_switch_requires_installer(
					_svc_script.RUNTIME_COLIMA,
					_svc_script.RUNTIME_DOCKER_DESKTOP)))
	_sections += 1


## Il PATH ridotto delle app con interfaccia (O-13b). Su macOS un'app aperta
## dal Finder eredita /usr/bin:/bin:/usr/sbin:/sbin: `colima` e `docker` di
## Homebrew stanno altrove, e senza le cartelle aggiuntive il probe dichiara
## "niente installato" su una macchina che ha entrambi — che è esattamente il
## racconto dell'operatore.
func _gui_path_contract() -> void:
	var brew := _stub_dir("finder-brew")
	_write_stub(brew.path_join("docker"),
			"#!/bin/sh\necho '29.6.0|29.6.0'\nexit 0\n")
	_write_stub(brew.path_join("colima"), "#!/bin/sh\nexit 0\n")
	_write_stub(brew.path_join("podman"), "#!/bin/sh\nexit 0\n")
	# Il PATH che launchd passa a un'app: nessuna traccia di Homebrew.
	_set_path(PackedStringArray([_stub_dir("finder-launchd")]))
	_svc_script.extra_bin_dirs = [] as Array[String]
	_check("PATH ridotto: senza cartelle aggiuntive docker risulta assente",
			str(_svc_script._which("docker")) == "")
	_svc_script.extra_bin_dirs = [brew] as Array[String]
	_check("PATH ridotto: la cartella aggiuntiva ritrova docker",
			str(_svc_script._which("docker")) == brew.path_join("docker"))
	# _bin esiste perché OS.execute eredita il PATH del processo, non quello
	# aumentato: senza percorso pieno il probe "vede" un docker che poi non
	# riesce a lanciare.
	_check("PATH ridotto: il comando si lancia col percorso pieno",
			str(_svc_script._bin("docker")) == brew.path_join("docker"))
	_check("PATH ridotto: un percorso già esplicito passa intatto",
			str(_svc_script._bin("/bin/sh")) == "/bin/sh")
	if OS.get_name() == "macOS":
		var installed: PackedStringArray = _svc_script.installed_runtimes()
		_check("solo Colima: il motore è riconosciuto, non da installare",
				installed.has(_svc_script.RUNTIME_COLIMA),
				str(installed))
		_check("Podman non preparato: il binario da solo non è selezionabile",
				not installed.has(_svc_script.RUNTIME_PODMAN), str(installed))
		_check("solo Colima: INSTALLA DOCKER non deve comparire",
				not bool(_svc_script.runtime_missing({"runtimes": installed})))
		# Tolta la rete, lo stesso computer torna a non vedere Colima: è la
		# prova che il caso «runtime assente» resta raggiungibile e che la
		# differenza la fanno le cartelle, non la macchina.
		_svc_script.extra_bin_dirs = [] as Array[String]
		_set_path(PackedStringArray([_stub_dir("finder-empty")]))
		_check("runtime assente: senza le cartelle aggiuntive Colima sparisce",
				not (_svc_script.installed_runtimes() as PackedStringArray).has(
					_svc_script.RUNTIME_COLIMA))
	_svc_script.extra_bin_dirs = [] as Array[String]
	_sections += 1


## I tre stati del probe vero (_probe_host), con finti docker nel PATH.
func _probe_three_states() -> void:
	var home := _stub_dir("home")

	# 1) Docker ASSENTE: PATH senza docker → schermata "installa".
	_set_path(PackedStringArray([_stub_dir("no-docker")]))
	var probe: Dictionary = _svc_script._probe_host(home)
	_check("assente: docker_available=false (era il bug: 127 letto come "
			+ "presenza)", not bool(probe.get("docker_available", true)),
			str(probe.get("docker_available")))
	_check("assente: docker_running=false",
			not bool(probe.get("docker_running", true)))

	# 2) Docker PRESENTE ma daemon SPENTO: risponde con l'errore vero e
	#    esce 1 → schermata "avvia il motore", NON "installa".
	var off := _stub_dir("daemon-off")
	_write_stub(off.path_join("docker"), "\n".join([
		"#!/bin/sh",
		"echo '29.6.0|'",
		"echo 'failed to connect to the docker API at" +
				" unix:///var/run/docker.sock' >&2",
		"exit 1",
	]) + "\n")
	_set_path(PackedStringArray([off]))
	probe = _svc_script._probe_host(home)
	_check("spento: docker_available=true",
			bool(probe.get("docker_available", false)))
	_check("spento: docker_running=false",
			not bool(probe.get("docker_running", true)))

	# 3) Docker ATTIVO: `version` esce 0 → si procede col probe del
	#    container (qui inesistente: il finto docker nega tutto il resto).
	var on := _stub_dir("daemon-on")
	_write_stub(on.path_join("docker"), "\n".join([
		"#!/bin/sh",
		"case \"$1\" in",
		"version) echo '29.6.0|29.6.0'; exit 0 ;;",
		"*) echo 'Error: No such object: jht' >&2; exit 1 ;;",
		"esac",
	]) + "\n")
	_set_path(PackedStringArray([on]))
	probe = _svc_script._probe_host(home)
	_check("attivo: docker_available=true",
			bool(probe.get("docker_available", false)))
	_check("attivo: docker_running=true",
			bool(probe.get("docker_running", false)))
	_check("attivo: container inesistente rilevato",
			not bool(probe.get("container_exists", true)))

	# 4) Il caso AMBIGUO: un docker presente che esce 127. Un criterio a soli
	#    codici lo leggerebbe "assente"; il file nel PATH dice il contrario.
	var odd := _stub_dir("exit-127")
	_write_stub(odd.path_join("docker"),
			"#!/bin/sh\necho 'boom' >&2\nexit 127\n")
	_set_path(PackedStringArray([odd]))
	probe = _svc_script._probe_host(home)
	_check("ambiguo: binario presente che esce 127 resta available=true",
			bool(probe.get("docker_available", false)))
	_check("ambiguo: ma il daemon non risulta attivo",
			not bool(probe.get("docker_running", true)))
	_sections += 1


## Regressione T-012: un setup fatto dalla CLI può avere il config migrato v4
## con `agents.list=[]` e, separatamente, sessioni tmux già vive. Il client non
## usa quella lista storica per il roster: come `jht team status`, osserva tmux.
## La checklist resta incompleta (piano/profilo/orari sono fatti distinti), ma
## il team non può per questo tornare falso o sparire dall'ufficio.
func _cli_started_team_contract() -> void:
	var home := _stub_dir("cli-started-home")
	_write_stub(home.path_join("jht.config.json"), JSON.stringify({
		"version": 4,
		"active_provider": "kimi",
		"providers": {"kimi": {"auth_method": "subscription"}},
		"agents": {"list": []},
		"notifications": {"enabled": true, "channels": []},
		"analytics": {"enabled": true, "retention_days": 30},
	}) + "\n", false)
	var active := _stub_dir("cli-started-docker")
	_write_stub(active.path_join("docker"), "\n".join([
		"#!/bin/sh",
		"case \"$1:$4\" in",
		"version:*) echo '29.6.0|29.6.0'; exit 0 ;;",
		"inspect:*State.Status*) echo running; exit 0 ;;",
		"inspect:*State.Running*) echo true; exit 0 ;;",
		"inspect:*Image*) echo sha256:runtime; exit 0 ;;",
		"image:*) exit 1 ;;",
		"exec:*) printf 'ASSISTENTE\\nCAPITANO\\nMENTOR\\nSENTINELLA\\n'; exit 0 ;;",
		"*) exit 1 ;;",
		"esac",
	]) + "\n")
	_set_path(PackedStringArray([active]))
	var probe: Dictionary = _svc_script._probe_host(home)
	_check("CLI→client: Assistente di onboarding non è un team operativo",
			not bool(_svc_script._agents_have_operational_team([
				{"role": "assistente", "active": true}])))
	_check("CLI→client: Capitano nel roster è un team operativo",
			bool(_svc_script._agents_have_operational_team([
				{"role": "capitano", "active": true}])))
	_check("CLI→client: agents.list vuota non nasconde il roster tmux",
			bool(probe.get("team_running", false)), JSON.stringify(probe))
	_check("CLI→client: provider del config v4 condiviso riconosciuto",
			str(probe.get("active_provider", "")) == "kimi",
			str(probe.get("active_provider", "")))
	_check("CLI→client: checklist non inventata dal solo roster",
			not bool(probe.get("plan_ready", true))
			and not bool(probe.get("profile_ready", true))
			and not bool(probe.get("hours_ready", true)), JSON.stringify(probe))
	_sections += 1
