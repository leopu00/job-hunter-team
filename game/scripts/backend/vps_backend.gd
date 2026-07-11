class_name VpsBackend
extends BackendAdapter
## Backend REALE: parla via SSH con una VPS del team (container Docker
## `jht`, stato in /jht_home). Legge, non scrive: l'app osserva il team.
## Eccezioni autorizzate da Leone: la chat utente↔agente e il TICKET
## utente→team (gate 1 dell'11/07) — mai scritture dirette sui dati.
##
## Ciclo: start() → CONNECTING → handshake ssh → CONNECTED → poll del
## roster (sessioni tmux nel container = agenti attivi) finché stop().
## Tutto l'I/O vive in un Thread; verso il bus solo call_deferred.

const POLL_SECS := 8.0
const SSH_TIMEOUT := 8
const CHAT_BACKLOG := 60   # storia team mostrata al collegamento
const CHAT_MARK := "---JHT-CHAT---"
const THROTTLE_MARK := "---JHT-THROTTLE---"

## Roster, chat e throttle in UN solo giro ssh. NIENTE quoting annidato
## qui dentro (sh -c con apici e #{} si è già rotto una volta nel viaggio
## OS.execute→ssh→shell remota): il ; lo interpreta la shell remota,
## tmux ls resta in formato default e il nome sessione si estrae dai ':'.
const POLL_CMD := "docker exec jht tmux ls 2>/dev/null; echo ---JHT-CHAT---; " \
		+ "docker exec jht tail -n 80 /jht_home/logs/messages.jsonl 2>/dev/null; " \
		+ "echo ---JHT-THROTTLE---; " \
		+ "docker exec jht tail -n 60 /jht_home/logs/throttle-events.jsonl 2>/dev/null"

## Snapshot posizioni dal jobs.db (stesso dataset leggero dei facets del
## web), letto con python3 nel container (sqlite3 CLI assente).
##
## ⚠️ GOTCHA OS.execute (macOS): gli argomenti vengono re-wrappati in
## una sh -c con quoting naive — doppi apici, $, # e newline DENTRO un
## argomento si corrompono SEMPRE. Ricetta obbligata per i comandi
## remoti: solo apici singoli, una riga sola, e le stringhe che
## servirebbero allo script python passate via sys.argv.
const POSITIONS_PY := "import sys,sqlite3,json; db=sqlite3.connect(sys.argv[1]); " \
		+ "db.row_factory=sqlite3.Row; q=lambda s: [dict(r) for r in db.execute(s)]; " \
		+ "print(json.dumps(dict(p=q(sys.argv[2]),h=q(sys.argv[3]),t=q(sys.argv[4])," \
		+ "tr=q(sys.argv[5]))))"
## La lista serve i facet, il dettaglio tutto il resto (mai jd_text: enorme).
const POSITIONS_SELECT := "SELECT p.id,p.title,p.company,p.status,p.role_family," \
		+ "p.loc_country,p.loc_city,p.work_mode,p.source,p.url,p.jd_summary," \
		+ "p.found_by,p.found_at,p.last_checked,p.deadline,p.is_open,p.created_at," \
		+ "p.write_requested,p.geocode_requested,p.recheck_requested," \
		+ "p.user_excluded_reason,p.user_excluded_note," \
		+ "p.salary_declared_min,p.salary_declared_max,p.salary_declared_currency," \
		+ "p.salary_estimated_min,p.salary_estimated_max,p.salary_estimated_currency," \
		+ "p.office_lat,p.office_lon," \
		+ "s.total_score,s.stack_match,s.remote_fit,s.salary_fit,s.experience_fit," \
		+ "s.strategic_fit,s.scored_by,s.scored_at,s.notes AS score_notes," \
		+ "a.critic_score,a.critic_verdict,a.critic_notes,a.written_by,a.written_at " \
		+ "FROM positions p LEFT JOIN scores s ON s.position_id=p.id " \
		+ "LEFT JOIN applications a ON a.position_id=p.id " \
		+ "ORDER BY p.created_at DESC"
const HIGHLIGHTS_SELECT := "SELECT position_id,type,text FROM position_highlights ORDER BY id"
const TICKETS_SELECT := "SELECT position_id,request_text,kind,status,assigned_agent," \
		+ "response_text,created_at FROM position_tickets ORDER BY id"
## Il registro attività del team (/team/log del web): chi ha fatto cosa,
## con attribuzione per-istanza (scout-2, scorer-1...).
const TRANSITIONS_SELECT := "SELECT t.position_id,t.from_state,t.to_state,t.ts," \
		+ "t.by_agent,p.title,p.company FROM position_state_transitions t " \
		+ "LEFT JOIN positions p ON p.id=t.position_id ORDER BY t.id DESC LIMIT 80"

const POSITIONS_EVERY := 4  # giri di poll tra due letture del jobs.db
const SETTINGS_EVERY := 8   # config/usage cambiano raramente

## Config team + usage REALI, già in forma di coppie [etichetta, valore]
## per le sezioni della sidebar. SOLO campi safe: mai chiavi/credenziali.
const SETTINGS_PY := """
import json
out = {}
try:
    c = json.load(open('/jht_home/jht.config.json'))
except Exception:
    c = {}
ap = str(c.get('active_provider', ''))
p = (c.get('providers') or {}).get(ap, {}) or {}
sub = p.get('subscription')
if isinstance(sub, dict):
    sub = sub.get('email') or ', '.join(str(v) for v in sub.values())
out['provider'] = [
    ['Provider attivo', ap or '—'],
    ['Modello', str(p.get('model', '—'))],
    ['Abbonamento', str(sub or '—')],
    ['Autenticazione', str(p.get('auth_method', '—'))],
]
wh = ((c.get('team') or {}).get('working_hours') or {})
out['hours'] = [
    ['Timezone', str(wh.get('timezone', '—'))],
    ['Finestre di lavoro', json.dumps(wh.get('windows', '—'), ensure_ascii=False)[:120]],
]
out['hours_raw'] = wh
n = c.get('notifications') or {}
out['email'] = [
    ['Notifiche', 'attive' if n.get('enabled') else 'spente'],
    ['Canali', ', '.join(map(str, n.get('channels') or [])) or '—'],
]
a = c.get('analytics') or {}
out['advanced'] = [
    ['Config version', str(c.get('version', '—'))],
    ['Analytics', 'on' if a.get('enabled') else 'off'],
    ['Retention (giorni)', str(a.get('retention_days', '—'))],
]
try:
    import yaml
    prof = yaml.safe_load(open('/jht_home/profile/candidate_profile.yml')) or {}
    rows = []
    for key, label in [('name', 'Nome'), ('target_role', 'Ruolo target'),
                       ('location', 'Localita'), ('experience_years', 'Anni di esperienza'),
                       ('seniority_target', 'Seniority target'), ('industry', 'Settore'),
                       ('nationality', 'Nazionalita')]:
        if prof.get(key) is not None:
            rows.append([label, str(prof[key])])
    skills = (prof.get('skills') or {}).get('primary') or []
    if skills:
        rows.append(['Skill primarie', ', '.join(map(str, skills[:8]))])
    sal = prof.get('salary_target') or prof.get('salary') or {}
    if isinstance(sal, dict) and sal:
        lo = sal.get('min') or sal.get('lo')
        hi = sal.get('max') or sal.get('hi')
        cur = sal.get('currency') or 'EUR'
        if lo or hi:
            rows.append(['Salary target', str(lo) + ' - ' + str(hi) + ' ' + str(cur)])
    elif sal:
        rows.append(['Salary target', str(sal)[:80]])
    if rows:
        out['profile'] = rows
    raw = {}
    for key in ['name', 'target_role', 'location', 'experience_years',
                'seniority_target', 'industry', 'nationality']:
        if prof.get(key) is not None:
            raw[key] = str(prof[key])
    raw['skills_primary'] = ', '.join(map(str, skills))
    if isinstance(sal, dict):
        raw['salary_min'] = str(sal.get('min') or sal.get('lo') or '')
        raw['salary_max'] = str(sal.get('max') or sal.get('hi') or '')
        raw['salary_currency'] = str(sal.get('currency') or 'EUR')
    out['profile_raw'] = raw
except Exception:
    pass
try:
    ps = json.load(open('/jht_home/logs/pacing-bridge-state.json'))
    out['work_phase'] = str(ps.get('work_phase', ''))
except Exception:
    pass
try:
    u = json.load(open('/jht_home/logs/agent-usage-table.json'))
    tot = {}
    for row in u.get('series_kt_per_bucket', []):
        for k, v in row.items():
            if k != 'ts':
                tot[k] = round(tot.get(k, 0) + float(v), 1)
    out['usage'] = {'window_h': u.get('window_h'), 'per_agent_kt': tot,
                    'generated_at': str(u.get('generated_at', ''))}
except Exception:
    pass
print(json.dumps(out, ensure_ascii=False))
"""

var _ip := ""
var _key := ""
var _user := "root"
var _thread: Thread
var _stop := false
var _last_chat_ts := ""
## Conversazione utente↔agente aperta ("capitano"/"assistente", "" = no).
var _convo_agent := ""


func start(config: Dictionary) -> void:
	live = true  # dati veri: spegne il badge SIMULAZIONE quando connesso
	_ip = str(config.get("ip", "")).strip_edges()
	_key = str(config.get("key_path", "")).strip_edges()
	_user = str(config.get("user", "root")).strip_edges()
	bus.publish_state(BackendBus.CONNECTING, "handshake ssh con %s…" % _ip)
	_stop = false
	_thread = Thread.new()
	_thread.start(_run)


func stop() -> void:
	_stop = true
	if _thread and _thread.is_started():
		_thread.wait_to_finish()
	_thread = null


## ── Thread di I/O ─────────────────────────────────────────────────────

func _run() -> void:
	# handshake: la VPS risponde e il container jht esiste?
	var probe := _ssh("echo JHT_OK; docker inspect jht --format {{.State.Status}}")
	if _stop:
		return
	if probe["code"] != 0 or not probe["out"].contains("JHT_OK"):
		_deferred_state(BackendBus.ERROR, _short_error(probe))
		return
	if not probe["out"].contains("running"):
		_deferred_state(BackendBus.ERROR, "container jht non in esecuzione")
		return
	_deferred_state(BackendBus.CONNECTED, _ip)

	# poll di roster + chat (+ posizioni, più raro) finché non ci fermano
	var failures := 0
	var tick := 0
	while not _stop:
		var res := _ssh(POLL_CMD)
		if _stop:
			return
		if res["code"] == 0:
			if failures > 0:
				failures = 0
				_deferred_state(BackendBus.CONNECTED, _ip)
			var parts: PackedStringArray = str(res["out"]).split(CHAT_MARK)
			var chat_raw := ""
			var throttle_raw := ""
			if parts.size() > 1:
				var tail: PackedStringArray = parts[1].split(THROTTLE_MARK)
				chat_raw = tail[0]
				if tail.size() > 1:
					throttle_raw = tail[1]
			var roster := _parse_roster(parts[0], _parse_throttles(throttle_raw))
			# mappa uid → sessione tmux per la chat (dict nuovo assegnato
			# in blocco: niente stati intermedi visti dagli altri thread)
			var sessions := {}
			for a in roster:
				sessions[a["uid"]] = a["session"]
			_agent_sessions = sessions
			bus.call_deferred("publish_agents", roster)
			if chat_raw != "":
				_ingest_chat(chat_raw)
		else:
			failures += 1
			if failures >= 2:  # un blip singolo non è un guasto
				_deferred_state(BackendBus.ERROR, _short_error(res))
		if tick % POSITIONS_EVERY == 0:
			_fetch_positions()
		if tick % SETTINGS_EVERY == 0:
			_fetch_settings()
		if _convo_agent != "":
			_fetch_convo(_convo_agent)
		tick += 1
		# con una conversazione aperta il giro accorcia: la risposta
		# dell'agente deve comparire in fretta, non dopo 8 secondi
		_sleep(2.5 if _convo_agent != "" else POLL_SECS)


## jobs.db → positions_updated: snapshot completo con highlights e
## ticket già agganciati per posizione (la vista filtra e naviga locale).
func _fetch_positions() -> void:
	var res := _ssh("docker exec -i jht python3 -c '" + POSITIONS_PY \
			+ "' /jht_home/jobs.db '" + POSITIONS_SELECT + "' '" \
			+ HIGHLIGHTS_SELECT + "' '" + TICKETS_SELECT + "' '" \
			+ TRANSITIONS_SELECT + "'")
	if _stop or res["code"] != 0:
		if not _stop:
			Log.call_deferred("debug", "backend", "fetch posizioni KO: code=%s %s" % [
					res["code"], str(res["out"]).left(120)])
		return
	var raw := str(res["out"]).strip_edges()
	# stdout può avere righe di warning attorno: il JSON è la riga con {
	for line in raw.split("\n"):
		if line.begins_with("{"):
			var data: Variant = JSON.parse_string(line)
			if data is Dictionary:
				# transitions vanno sul bus PRIMA del segnale: le viste
				# le leggono al positions_updated (unico tick dati)
				bus.set_deferred("transitions", data.get("tr", []))
				bus.call_deferred("publish_positions", _assemble_positions(data))
			return

## jht.config.json + usage table → BackendBus.live_settings (le sezioni
## config della sidebar e la pagina Utilizzo mostrano il reale).
func _fetch_settings() -> void:
	var res := _ssh_python(SETTINGS_PY)
	if _stop or res["code"] != 0:
		return
	for line in str(res["out"]).split("\n"):
		if line.begins_with("{"):
			var data: Variant = JSON.parse_string(line)
			if data is Dictionary:
				bus.call_deferred("publish_settings", data)
			return


## Unisce le tre SELECT: highlights e ticket dentro la loro posizione.
static func _assemble_positions(data: Dictionary) -> Array:
	var by_id := {}
	var rows: Array = data.get("p", [])
	for p in rows:
		p["highlights"] = []
		p["tickets"] = []
		by_id[p["id"]] = p
	for h in data.get("h", []):
		if by_id.has(h.get("position_id")):
			by_id[h["position_id"]]["highlights"].append(h)
	for t in data.get("t", []):
		if by_id.has(t.get("position_id")):
			by_id[t["position_id"]]["tickets"].append(t)
	return rows


## Coda di messages.jsonl → chat_message sul bus, solo il nuovo rispetto
## al cursore (ts ISO UTC: il confronto lessicografico è cronologico).
## Al primo giro passa solo un piccolo backlog, non tutta la storia.
func _ingest_chat(raw: String) -> void:
	var msgs: Array = []
	for line in raw.split("\n"):
		if line.strip_edges() == "":
			continue
		var d: Variant = JSON.parse_string(line)
		if d == null or not (d is Dictionary):
			continue
		var m := _to_chat_msg(d)
		if not m.is_empty() and str(m["ts"]) > _last_chat_ts:
			msgs.append(m)
	if msgs.is_empty():
		return
	if _last_chat_ts == "" and msgs.size() > CHAT_BACKLOG:
		msgs = msgs.slice(msgs.size() - CHAT_BACKLOG)
	_last_chat_ts = str(msgs[-1]["ts"])
	for m in msgs:
		bus.call_deferred("publish_chat", m)


## Una riga di messages.jsonl → il contratto {ts, from, to, text}.
## Scarta il rumore non-agente (tick del bridge/pacing senza mittente).
## Il testo è COMPLETO (body quando c'è, mai troncato: feedback Leone
## 21:2x): chi ha vincoli di spazio (i fumetti) accorcia da sé.
static func _to_chat_msg(d: Dictionary) -> Dictionary:
	var from := _slug_norm(str(d.get("from", "")))
	if from == "" or from == "pacing" or from == "bridge":
		return {}
	var to := _slug_norm(str(d.get("to", "")))
	if to == "":
		to = _slug_norm(str(d.get("session", "")))
	var text := str(d.get("body", "")).strip_edges()
	if text == "":
		text = str(d.get("preview", "")).strip_edges()
	if text == "":
		return {}
	return {"ts": str(d.get("ts", "")), "from": from, "to": to, "text": text}


## Nomi del sistema reale → slug del gioco (capitano → coordinatore).
static func _slug_norm(name: String) -> String:
	var s := name.strip_edges().to_lower().replace("-worker", "")
	return "coordinatore" if s == "capitano" else s


## ── Chat bidirezionale utente ↔ agente ───────────────────────────────
## Invio = il canale della desktop app: persist del messaggio utente in
## chat.jsonl + payload [@utente -> @<agent>] [CHAT] nella tmux
## dell'agente via load-buffer/paste-buffer. Il testo NON attraversa mai
## una shell come argomento (gotcha OS.execute): viaggia su file
## temporaneo locale e arriva al remoto via stdin (bash-c col redirect,
## comandi senza caratteri velenosi; append remoto con tee -a, mai sh -c).
## Chat 1-a-1 con OGNI agente del roster: l'uid del gioco si risolve in
## directory (/jht_home/agents/<dir>/) e sessione tmux raw dal poll.

var _agent_sessions := {}  # uid → nome sessione tmux (dal roster)

## uid del gioco → directory dell'agente sotto /jht_home/agents/
## (il coordinatore del gioco è il capitano del sistema reale).
static func _agent_dir(uid: String) -> String:
	return "capitano" if uid == "coordinatore" else uid

func _agent_session(uid: String) -> String:
	return str(_agent_sessions.get(uid, _agent_dir(uid).to_upper()))

func open_chat(agent: String) -> void:
	_convo_agent = agent

func close_chat() -> void:
	_convo_agent = ""

func send_chat(agent: String, text: String) -> void:
	if text.strip_edges() == "":
		return
	# thread one-shot: 3 giri ssh non devono congelare né la UI né il poll
	WorkerThreadPool.add_task(_do_send_chat.bind(agent, text.strip_edges()))

func _do_send_chat(agent: String, text: String) -> void:
	var session := _agent_session(agent)
	var buf := "/tmp/jht-game-chat-%d-%d.txt" % [OS.get_process_id(), Time.get_ticks_usec()]
	var chat_file := "/jht_home/agents/%s/chat.jsonl" % _agent_dir(agent)

	# 1) persisti il messaggio utente nel chat.jsonl dell'agente (stesso
	# formato della skill chat-web: la UI lo rilegge come storia)
	var f := FileAccess.open(buf, FileAccess.WRITE)
	if f == null:
		_chat_sent(agent, false, "file temporaneo non scrivibile")
		return
	f.store_string(JSON.stringify({"role": "user", "text": text,
			"ts": Time.get_unix_time_from_system()}) + "\n")
	f.close()
	var persist := _ssh_stdin_file(buf, "docker exec -i jht tee -a " + chat_file)
	if persist["code"] != 0:
		Log.call_deferred("warn", "backend", "chat: persist fallito (non blocco): "
				+ _short_error(persist))

	# 2) payload nella tmux dell'agente: load-buffer da stdin, poi paste
	f = FileAccess.open(buf, FileAccess.WRITE)
	f.store_string("[@utente -> @%s] [CHAT] %s" % [agent, text])
	f.close()
	var load := _ssh_stdin_file(buf, "docker exec -i jht tmux load-buffer -")
	DirAccess.remove_absolute(buf)
	if load["code"] != 0:
		_chat_sent(agent, false, _short_error(load))
		return
	var paste := _ssh("docker exec jht tmux paste-buffer -t " + session)
	if paste["code"] != 0:
		_chat_sent(agent, false, _short_error(paste))
		return
	var enter := _ssh("docker exec jht tmux send-keys -t " + session + " Enter")
	if enter["code"] != 0:
		_chat_sent(agent, false, _short_error(enter))
		return
	_chat_sent(agent, true, "")
	_fetch_convo(agent)  # eco immediato del messaggio persistito

func _chat_sent(agent: String, ok: bool, error: String) -> void:
	bus.call_deferred("publish_chat_sent", agent, ok, error)

## ── Profilo utente: editing PIENO (paradigma desktop app, 21:26) ─────
## Il candidate_profile.yml è un dato dell'UTENTE: si modifica da qui.
## I campi viaggiano BASE64 (json) dentro lo script python → file+stdin,
## mai in una shell. Prima di riscrivere, backup timestampato sul posto.

const PROFILE_SAVE_PY := """
import json, base64, shutil, time, yaml
data = json.loads(base64.b64decode('%s').decode('utf-8'))
path = '/jht_home/profile/candidate_profile.yml'
try:
    prof = yaml.safe_load(open(path)) or {}
except Exception:
    prof = {}
try:
    shutil.copy2(path, path + '.bak-' + time.strftime('%%Y%%m%%dT%%H%%M%%S'))
except Exception:
    pass
for key in ['name', 'target_role', 'location', 'experience_years',
            'seniority_target', 'industry', 'nationality']:
    if key in data and str(data[key]).strip() != '':
        v = str(data[key]).strip()
        # i numerici restano numeri nel yml (experience_years: 1, non '1')
        try:
            v = int(v)
        except ValueError:
            try:
                v = float(v)
            except ValueError:
                pass
        prof[key] = v
if 'skills_primary' in data:
    skills = [s.strip() for s in str(data['skills_primary']).split(',') if s.strip()]
    prof.setdefault('skills', {})['primary'] = skills
if data.get('salary_min') or data.get('salary_max'):
    sal_key = 'salary_target' if 'salary_target' in prof or 'salary' not in prof else 'salary'
    sal = prof.get(sal_key) if isinstance(prof.get(sal_key), dict) else {}
    lo_key = 'lo' if 'lo' in sal else 'min'
    hi_key = 'hi' if 'hi' in sal else 'max'
    if data.get('salary_min'):
        sal[lo_key] = int(float(data['salary_min']))
    if data.get('salary_max'):
        sal[hi_key] = int(float(data['salary_max']))
    sal['currency'] = str(data.get('salary_currency', sal.get('currency', 'EUR')))
    prof[sal_key] = sal
yaml.safe_dump(prof, open(path, 'w'), allow_unicode=True, sort_keys=False)
print(json.dumps(dict(ok=True)))
"""

func save_profile(fields: Dictionary) -> void:
	WorkerThreadPool.add_task(_do_save_profile.bind(fields))

func _do_save_profile(fields: Dictionary) -> void:
	var b64 := Marshalls.utf8_to_base64(JSON.stringify(fields))
	var res := _ssh_python(PROFILE_SAVE_PY % b64)
	var ok: bool = res["code"] == 0 and str(res["out"]).contains("\"ok\": true")
	bus.call_deferred("emit_signal", "profile_saved", ok,
			"" if ok else _short_error(res))
	if ok:
		_fetch_settings()  # il profilo aggiornato rientra subito in vista


## ── Orari di lavoro: editing PIENO (paradigma desktop app) ───────────
## working_hours vive in jht.config.json: si aggiorna SOLO quella
## sezione (load→update→dump preserva tutto il resto, credenziali
## incluse — che non lasciano mai il container), con backup prima.

const HOURS_SAVE_PY := """
import json, base64, shutil, time
data = json.loads(base64.b64decode('%s').decode('utf-8'))
path = '/jht_home/jht.config.json'
c = json.load(open(path))
try:
    shutil.copy2(path, path + '.bak-' + time.strftime('%%Y%%m%%dT%%H%%M%%S'))
except Exception:
    pass
c.setdefault('team', {})['working_hours'] = data
json.dump(c, open(path, 'w'), indent=2, ensure_ascii=False)
print(json.dumps(dict(ok=True)))
"""

func save_working_hours(wh: Dictionary) -> void:
	WorkerThreadPool.add_task(_do_save_hours.bind(wh))

func _do_save_hours(wh: Dictionary) -> void:
	var b64 := Marshalls.utf8_to_base64(JSON.stringify(wh))
	var res := _ssh_python(HOURS_SAVE_PY % b64)
	var ok: bool = res["code"] == 0 and str(res["out"]).contains("\"ok\": true")
	bus.call_deferred("emit_signal", "hours_saved", ok,
			"" if ok else _short_error(res))
	if ok:
		_fetch_settings()


## ── Ticket utente→team (gate 1: l'unica scrittura sul jobs.db) ───────
## Stesso INSERT della route /api/positions/[id]/ticket del web: ticket
## 'open' kind 'custom' su position_tickets, che il Capitano nota e
## smista (ticket.py list-open). Il testo utente è velenoso per la shell
## (gotcha OS.execute) → viaggia BASE64 dentro lo script python, che a
## sua volta arriva al container via file+stdin: niente quoting, mai.

const TICKET_MAX_LEN := 2000  # stesso limite della route web

const TICKET_PY := """
import sqlite3, base64, json
text = base64.b64decode('%s').decode('utf-8')
pid = %d
db = sqlite3.connect('/jht_home/jobs.db')
try:
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('PRAGMA foreign_keys=ON')
    if db.execute('SELECT id FROM positions WHERE id=?', (pid,)).fetchone() is None:
        print(json.dumps(dict(ok=False, error='posizione inesistente')))
    else:
        cur = db.execute(
            "INSERT INTO position_tickets (position_id, request_text, kind, status) "
            "VALUES (?, ?, 'custom', 'open')", (pid, text))
        db.commit()
        print(json.dumps(dict(ok=True, id=cur.lastrowid)))
finally:
    db.close()
"""

func create_ticket(position_id: int, text: String) -> void:
	var t := text.strip_edges().left(TICKET_MAX_LEN)
	if t == "" or position_id <= 0:
		return
	# thread one-shot: l'INSERT remoto non deve congelare UI né poll
	WorkerThreadPool.add_task(_do_create_ticket.bind(position_id, t))

func _do_create_ticket(position_id: int, text: String) -> void:
	var res := _ssh_python(TICKET_PY % [Marshalls.utf8_to_base64(text), position_id])
	var ok := false
	var err := ""
	if res["code"] != 0:
		err = _short_error(res)
	else:
		err = "risposta illeggibile dalla VPS"
		for line in str(res["out"]).split("\n"):
			if line.begins_with("{"):
				var d: Variant = JSON.parse_string(line)
				if d is Dictionary:
					ok = bool(d.get("ok", false))
					err = str(d.get("error", ""))
				break
	bus.call_deferred("emit_signal", "ticket_created", position_id, ok, err)
	if ok:
		_fetch_positions()  # il ticket nuovo compare subito nel dettaglio


## Tail del chat.jsonl dell'agente → publish_agent_chat (storia completa
## recente, la UI ridisegna da zero: niente cursori da tenere in sync;
## il bus spegne l'indicatore di attesa quando vede la risposta).
func _fetch_convo(agent: String) -> void:
	var res := _ssh("docker exec jht tail -n 120 /jht_home/agents/%s/chat.jsonl"
			% _agent_dir(agent))
	if _stop or res["code"] != 0:
		return
	var msgs: Array = []
	for line in str(res["out"]).split("\n"):
		if not line.begins_with("{"):
			continue
		var d: Variant = JSON.parse_string(line)
		if d is Dictionary and str(d.get("text", "")) != "":
			msgs.append(d)
	bus.call_deferred("publish_agent_chat", agent, msgs)

## Esegue uno script python DENTRO il container passandolo via stdin
## (python3 -): nessun limite di quoting, script multi-linea liberi.
func _ssh_python(script: String) -> Dictionary:
	var buf := "/tmp/jht-game-py-%d-%d.py" % [OS.get_process_id(), Time.get_ticks_usec()]
	var f := FileAccess.open(buf, FileAccess.WRITE)
	if f == null:
		return {"code": -1, "out": "file temporaneo non scrivibile"}
	f.store_string(script)
	f.close()
	var res := _ssh_stdin_file(buf, "docker exec -i jht python3 -")
	DirAccess.remove_absolute(buf)
	return res


## bash locale SOLO per il redirect < file: il comando non contiene mai
## testo utente né caratteri che il wrap naive di OS.execute corrompa.
func _ssh_stdin_file(local_file: String, remote_cmd: String) -> Dictionary:
	var out: Array = []
	var cmdline := "ssh -i " + _key \
			+ " -o BatchMode=yes -o IdentitiesOnly=yes" \
			+ " -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new " \
			+ _user + "@" + _ip + " " + remote_cmd + " < " + local_file
	var code := OS.execute("bash", ["-c", cmdline], out, true)
	return {"code": code, "out": "\n".join(PackedStringArray(out))}


## Un giro di ssh non interattivo. Ritorna {code, out} (stdout+stderr).
## Il remote_cmd deve rispettare la ricetta anti-quoting (vedi sopra).
func _ssh(remote_cmd: String) -> Dictionary:
	var out: Array = []
	var code := OS.execute("ssh", [
		"-i", _key,
		"-o", "BatchMode=yes",
		"-o", "IdentitiesOnly=yes",
		"-o", "ConnectTimeout=%d" % SSH_TIMEOUT,
		"-o", "StrictHostKeyChecking=accept-new",
		"%s@%s" % [_user, _ip],
		remote_cmd,
	], out, true)
	return {"code": code, "out": "\n".join(PackedStringArray(out))}


## throttle-events.jsonl (start/end del pacing reale) → throttle ATTIVI
## per istanza: {uid: {left: sec rimanenti, total: sec richiesti}}.
## Le righe sono in ordine: per ogni agente conta l'ULTIMO evento — uno
## start senza end la cui finestra copre "adesso" è un throttle in corso.
static func _parse_throttles(raw: String) -> Dictionary:
	var last := {}  # uid → ultimo evento
	for line in raw.split("\n"):
		if not line.begins_with("{"):
			continue
		var d: Variant = JSON.parse_string(line)
		if d is Dictionary and str(d.get("agent", "")) != "":
			last[_slug_norm(str(d["agent"]))] = d
	var now := Time.get_unix_time_from_system()
	var active := {}
	for uid in last:
		var ev: Dictionary = last[uid]
		if str(ev.get("event", "")) != "start":
			continue
		var total := float(ev.get("applied_sec", 0.0))
		var until := float(ev.get("ts_unix", 0.0)) + total
		if until > now:
			active[uid] = {"left": until - now, "total": total}
	return active

## Sessioni tmux (formato default "NOME: 1 windows …") → snapshot roster
## per il contratto agents_updated. CAPITANO → coordinatore; "scout-2" →
## slug scout, name "Scout 2", uid "scout-2" (chiave per-istanza, la
## stessa dei throttle e delle transitions). status dal throttle REALE:
## working (nessun throttle) | throttled (pausa del pacing in corso) —
## la scelta seduto-vs-ricreazione è della scena, sulla stima
## throttle_secs (secondi RIMANENTI; throttle_total = durata piena).
## Un agente killato non compare proprio: despawn = uscita dalla porta.
static func _parse_roster(raw: String, throttles: Dictionary = {}) -> Array:
	var agents: Array = []
	for line in raw.split("\n"):
		if not line.contains(":"):
			continue
		var session := line.split(":")[0].strip_edges()
		if session == "" or session.contains(" "):
			continue
		var uid := _slug_norm(session)
		var base := uid
		var num := ""
		var parts := base.split("-")
		if parts.size() > 1 and parts[parts.size() - 1].is_valid_int():
			num = parts[parts.size() - 1]
			base = "-".join(parts.slice(0, parts.size() - 1))
		var slug := base
		var name := slug.capitalize()
		if num != "":
			name += " " + num
		var status := "working"
		var t_left := 0.0
		var t_total := 0.0
		if throttles.has(uid):
			t_left = float(throttles[uid]["left"])
			t_total = float(throttles[uid]["total"])
			status = "throttled"
		agents.append({
			"slug": slug, "role": slug, "name": name, "uid": uid,
			"session": session,  # nome tmux RAW: serve alla chat 1-a-1
			"active": true, "status": status, "desk_hint": "",
			"throttle_secs": t_left, "throttle_total": t_total,
		})
	return agents


func _deferred_state(state: int, detail: String) -> void:
	bus.call_deferred("publish_state", state, detail)


## La riga utile dell'errore ssh, senza sommergere la UI.
static func _short_error(res: Dictionary) -> String:
	for line in str(res["out"]).split("\n"):
		var l := line.strip_edges()
		if l != "" and not l.begins_with("Warning:"):
			return l.left(120)
	return "ssh fallita (exit %s)" % res["code"]


## Sonno interrompibile: reagisce a stop() entro ~0.2s.
func _sleep(secs: float) -> void:
	var waited := 0.0
	while waited < secs and not _stop:
		OS.delay_msec(200)
		waited += 0.2
