class_name JhtFs
## I dati del team appartengono al container: qui si passa per parlarci.
##
## `~/.jht` è montata dentro il container, che gira come utente `jht` (uid
## 1001) e all'avvio se ne prende la proprietà. Su macOS non si nota — Docker
## Desktop e Colima rimappano gli uid — ma su Linux no: il gioco gira come
## l'utente (uid 1000) e su quei file prende "Permission denied". Nella
## giornata del 26/07 la stessa radice si è presentata tre volte con tre
## facce diverse:
##
##   · il provider non si poteva salvare  → "config non scrivibile"
##   · il runtime non si poteva preparare → "Impossibile preparare il runtime"
##   · il login non veniva mai rilevato   → credenziali 0600, illeggibili
##
## Non sono tre bug: è un bug solo, ed è l'assunzione che il gioco possa
## trattare `~/.jht` come roba sua. Da qui in avanti nessuno legge o scrive
## là dentro direttamente: si chiede al proprietario. Quando il container è
## acceso risponde lui (e i file nascono con l'utente giusto); quando è
## spento si ripiega sul disco, che in quel caso è ancora nostro.
##
## Restano legittimamente fuori da qui due cose, perché vengono PRIMA che il
## container esista: la creazione delle cartelle montate e il file compose
## (che ora vive nella cartella dell'applicazione, sempre scrivibile).

const CONTAINER := "jht"
const CONTAINER_HOME := "/jht_home"


## Home dei dati sul disco dell'utente. Unico posto in cui il path si compone.
static func host_home() -> String:
	var home := OS.get_environment("JHT_HOME")
	if home != "":
		return home.rstrip("/\\")
	home = OS.get_environment("USERPROFILE") if OS.get_name() == "Windows" \
			else OS.get_environment("HOME")
	return home.rstrip("/\\").path_join(".jht")


static func host_path(rel: String) -> String:
	return host_home().path_join(rel)


static func _run(path: String, args: PackedStringArray) -> Dictionary:
	var output: Array = []
	var code := OS.execute(path, args, output, true)
	return {"code": code, "out": "\n".join(PackedStringArray(output)).strip_edges()}


## Il container risponde? Una sola domanda a docker, non una per file.
static func container_ready() -> bool:
	var state := _run("docker", PackedStringArray(["inspect", CONTAINER,
			"--format", "{{.State.Running}}"]))
	return state["code"] == 0 and str(state["out"]).strip_edges() == "true"


static func _exec(script: String) -> Dictionary:
	return _run("docker", PackedStringArray(["exec", CONTAINER, "sh", "-c", script]))


## I percorsi sono costanti del programma, mai testo dell'utente: gli apici
## singoli bastano, e tengono insieme i nomi con spazi.
static func _quoted(rel: String) -> String:
	return "'%s/%s'" % [CONTAINER_HOME, rel.strip_edges().lstrip("/")]


## Sostituzione atomica nello stesso filesystem. Su Windows File.Replace è
## l'equivalente NTFS di rename(2); il ramo Move copre la prima creazione.
static func _replace_file(temporary: String, target: String) -> bool:
	if OS.get_name() == "Windows":
		var script := "& { param($temporary, $target) " \
				+ "if (Test-Path -LiteralPath $target) { " \
				+ "$backup = $target + '.game-backup-' + [guid]::NewGuid().ToString('N'); " \
				+ "try { [System.IO.File]::Replace($temporary, $target, $backup, $true) } " \
				+ "finally { if (Test-Path -LiteralPath $backup) { " \
				+ "Remove-Item -LiteralPath $backup -Force } } " \
				+ "} else { [System.IO.File]::Move($temporary, $target) } }"
		return _run("powershell.exe", PackedStringArray(["-NoProfile",
				"-NonInteractive", "-Command", script, temporary, target]))["code"] == 0
	return _run("mv", PackedStringArray(["-f", temporary, target]))["code"] == 0


## ── Lettura ────────────────────────────────────────────────────────────

## Il file esiste e ha contenuto? (Le credenziali vuote non valgono un login.)
static func has_content(rel: String, use_container: bool = true) -> bool:
	if use_container and container_ready():
		return _exec("test -s %s" % _quoted(rel))["code"] == 0
	var path := host_path(rel)
	if not FileAccess.file_exists(path):
		return false
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return false  # esiste ma non è nostro: per noi è come non averlo
	var size := f.get_length()
	f.close()
	return size > 0


## Il primo dei percorsi dati che ha contenuto, o "" se nessuno. Una sola
## chiamata al container per l'intera lista: il probe gira ogni pochi
## secondi e un `docker exec` per percorso costerebbe più della risposta.
static func first_with_content(paths: Array) -> String:
	if paths.is_empty():
		return ""
	if container_ready():
		var script := ""
		for rel in paths:
			script += "test -s %s && echo '%s' && exit 0; " % [_quoted(str(rel)), str(rel)]
		script += "exit 1"
		var res := _exec(script)
		if res["code"] == 0:
			return str(res["out"]).strip_edges()
		return ""
	for rel in paths:
		if has_content(str(rel), false):
			return str(rel)
	return ""


static func read_text(rel: String) -> String:
	if container_ready():
		var res := _exec("cat %s 2>/dev/null" % _quoted(rel))
		return str(res["out"]) if res["code"] == 0 else ""
	var path := host_path(rel)
	if not FileAccess.file_exists(path):
		return ""
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return ""
	var text := f.get_as_text()
	f.close()
	return text


static func read_json(rel: String) -> Dictionary:
	var text := read_text(rel)
	if text.strip_edges() == "":
		return {}
	var value: Variant = JSON.parse_string(text)
	return value if value is Dictionary else {}


## ── Scrittura ──────────────────────────────────────────────────────────

## Scrive un file di testo. Passando dal container il file nasce con il suo
## utente, che è esattamente ciò che serve: sarà lui a rileggerlo.
##
## Il contenuto viaggia in base64 e non come testo dentro la riga di comando:
## un YAML o un JSON contengono apici, a-capo e `$`, che una shell
## interpreterebbe. In base64 è solo alfanumerico e non c'è quoting da
## sbagliare.
static func write_text(rel: String, content: String) -> bool:
	if container_ready():
		var b64 := Marshalls.utf8_to_base64(content)
		var temporary := rel + ".game-tmp"
		var script := "mkdir -p \"$(dirname %s)\" && " \
				+ "echo '%s' | base64 -d > %s && mv -f %s %s" \
				% [_quoted(rel), b64, _quoted(temporary),
					_quoted(temporary), _quoted(rel)]
		return _exec(script)["code"] == 0
	var path := host_path(rel)
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var tmp := path + ".game-tmp"
	var f := FileAccess.open(tmp, FileAccess.WRITE)
	if f == null:
		return false
	f.store_string(content)
	f.close()
	return _replace_file(tmp, path)


## Restringe i permessi di un file (le credenziali non vanno lasciate 644).
static func chmod(rel: String, mode: String) -> bool:
	if container_ready():
		return _exec("chmod %s %s" % [mode, _quoted(rel)])["code"] == 0
	if OS.get_name() == "Windows":
		return true  # niente modo POSIX: ci pensano le ACL del profilo utente
	return _run("chmod", PackedStringArray([mode, host_path(rel)]))["code"] == 0


static func write_json(rel: String, data: Dictionary) -> bool:
	return write_text(rel, JSON.stringify(data, "  ") + "\n")


## Rimuove un file. Vero anche quando non c'era niente da rimuovere: il
## chiamante vuole sapere che DOPO non c'è, non che c'era prima. (Il logout
## dal provider falliva proprio qui: i file delle credenziali sono del
## container e `DirAccess.remove_absolute` non li poteva toccare.)
static func remove(rel: String) -> bool:
	if container_ready():
		return _exec("rm -f %s" % _quoted(rel))["code"] == 0
	var path := host_path(rel)
	if not FileAccess.file_exists(path):
		return true
	return DirAccess.remove_absolute(path) == OK


static func make_dir(rel: String) -> bool:
	if container_ready():
		return _exec("mkdir -p %s" % _quoted(rel))["code"] == 0
	return DirAccess.make_dir_recursive_absolute(host_path(rel)) == OK


## ── Diagnostica ────────────────────────────────────────────────────────

## La cartella dati c'è ma non possiamo scriverci, e il container è spento:
## è il vicolo cieco in cui nessuno dei due può agire. Serve saperlo per
## dirlo all'utente invece di lasciargli un errore muto.
static func host_home_blocked() -> bool:
	var home := host_home()
	if not DirAccess.dir_exists_absolute(home):
		return false
	if container_ready():
		return false
	var probe := home.path_join(".jht-write-probe")
	var f := FileAccess.open(probe, FileAccess.WRITE)
	if f == null:
		return true
	f.close()
	DirAccess.remove_absolute(probe)
	return false
