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
	_root_dir = OS.get_cache_dir().path_join(
			"jht-docker-probe-selftest-%d" % int(Time.get_ticks_usec()))
	var expected := 2
	_which_contract()
	_exec_present_contract()
	if OS.get_name() != "Windows":
		expected += 1
		_probe_three_states()
	OS.set_environment("PATH", _old_path)
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
