"""Headless TEMP bootstrap discriminant. No app autoload/data, Docker or SSH.

Run through the shared build turn. --baseline checks the original-jht-stopped
witness against d192. Presentation singletons and transport are inert stubs;
backend lifecycle and config function bodies come from the real source.
"""
import argparse
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--godot', default='godot')
parser.add_argument('--baseline', action='store_true')
args = parser.parse_args()

def read(path):
    if args.baseline:
        return subprocess.check_output(['git', 'show', 'd1927331d:' + path], cwd=ROOT).decode()
    return (ROOT / path).read_text()

fixture = Path(tempfile.mkdtemp(prefix='jht281-binding-'))
def put(name, text):
    path = fixture / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)

backend = read('game/scripts/backend/vps_backend.gd')
put('vps_backend.gd', backend)
put('backend_adapter.gd', read('game/scripts/backend/backend_adapter.gd'))
put('artifact_policy.gd', read('game/scripts/backend/artifact_policy.gd'))
for name in set(re.findall(r'payload\("([^"]+)"\)', backend)):
    put('scripts/backend/payloads/' + name, read('game/scripts/backend/payloads/' + name))
put('ui_strings.gd', 'class_name UIStrings\nextends RefCounted\nstatic func t(value):\n\treturn value\nstatic func vps_presentation_snapshot():\n\treturn {}\n')
put('agent_names.gd', 'class_name AgentNames\nextends RefCounted\nstatic func display_name(_uid, value):\n\treturn value\n')
put('bus.gd', 'extends Node\nconst CONNECTED=2\nconst CONNECTING=1\nconst ERROR=3\nvar live_settings={}\n')
put('log.gd', 'extends Node\n')
# Keep exact config function bodies, substitute only the fixture path.
bus = read('game/scripts/backend/backend_bus.gd')
names = ['load_vps_config', 'save_vps_config', 'same_vps_connection', 'vps_config_override']
functions = []
for name in names:
    match = re.search(r'^(?:static )?func ' + name + r'\([^\n]*\).*?(?=^(?:static )?func |\Z)', bus, re.M | re.S)
    if match:
        functions.append(match.group())
put('config_under_test.gd', 'extends RefCounted\nconst CONFIG_PATH = "res://fixture-vps.cfg"\n' + '\n'.join(functions))
extra = '' if 'var _desktop_bound' in backend else 'var _desktop_bound := false\nvar _desktop_runtime: Dictionary = {}\n'
put('probe.gd', '''extends VpsBackend
''' + extra + '''var transports: Array = []
var states: Array = []
var ordinary: Array = []
func _desktop_transport(source: String) -> Dictionary:
	transports.append(source)
	return {"code": 0, "out": JSON.stringify({"cid": _desktop_runtime.container_id, "reply": {"ok": true}})}
func _ssh(command: String) -> Dictionary:
	ordinary.append(command)
	return {"code": 0, "out": "JHT_OK\\nexited"}
func _sleep(_secs: float) -> void:
	_stop = true
func _deferred_state(state: int, _detail: String) -> void:
	states.append(state)
func _deferred_state_key(state: int, _key: String, _args: Array = []) -> void:
	states.append(state)
''')
put('project.godot', '''config_version=5
[application]
config/name="Isolated binding fixture"
run/main_scene="res://main.tscn"
[autoload]
BackendBus="*res://bus.gd"
Log="*res://log.gd"
''')
put('main.tscn', '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://check.gd" id="1"]\n[node name="Check" type="Node"]\nscript = ExtResource("1")\n')
checks = '''extends Node
var passed := 0
var failed := 0
func check(ok: bool, label: String) -> void:
	if ok: passed += 1
	else: failed += 1
	print("BINDING-CHECK ", label, " ", "PASS" if ok else "FAIL")
func _ready() -> void:
	var pins := {"container_id": "a".repeat(64), "oci_revision": "e".repeat(40), "image_id": "sha256:" + "f".repeat(64), "digest": "sha256:" + "1".repeat(64)}
	var probe = load("res://probe.gd").new()
	probe._desktop_bound = true
	probe._desktop_runtime = pins
	probe._run()
	check(probe.states == [BackendBus.CONNECTED] and probe.ordinary.is_empty() and probe.transports.size() == 1, "actual lifecycle handshake ignores stopped original and probes trusted candidate")
'''
if not args.baseline:
    checks += '''	var backend = load("res://vps_backend.gd").new()
	check(backend.valid_browser_runtime(pins) and not backend.valid_browser_runtime({}) and not backend.valid_browser_runtime({"container_id": "jht"}), "delivery binding validates all immutable pins")
	backend._desktop_bound = true
	backend._desktop_runtime = pins
	check(backend._ssh("docker inspect jht").code != 0 and backend._ssh_stdin_file("unused", "docker exec jht").code != 0, "ordinary polling and writes explicitly unavailable without transport")
	var config = load("res://config_under_test.gd").new()
	var file := ConfigFile.new()
	for key in pins: file.set_value("browser_runtime", key, pins[key])
	file.set_value("vps", "ip", "example.invalid")
	file.set_value("vps", "key_path", "fixture-key")
	file.set_value("vps", "user", "root")
	file.save(config.CONFIG_PATH)
	var loaded: Dictionary = config.load_vps_config()
	check(loaded.browser_runtime == pins, "real config loader carries trusted section before backend start")
	config.save_vps_config("example.invalid", "fixture-key", "")
	loaded = config.load_vps_config()
	check(loaded.browser_runtime == pins, "manual reconnect preserves binding for same effective connection")
	var same: Dictionary = config.vps_config_override(loaded, {"ip": "example.invalid", "key_path": "fixture-key", "user": "root"})
	var changed: Dictionary = config.vps_config_override(loaded, {"ip": "other.invalid", "key_path": "fixture-key", "user": "root"})
	check(same.browser_runtime == pins and changed.has("browser_runtime") and not backend.valid_browser_runtime(changed.browser_runtime), "environment connection change fails closed without silent legacy fallback")
	config.save_vps_config("other.invalid", "fixture-key", "root")
	loaded = config.load_vps_config()
	check(loaded.has("browser_runtime") and not backend.valid_browser_runtime(loaded.browser_runtime), "manual connection change invalidates binding until trusted redelivery")
'''
checks += '''	print("BINDING-RESULT ", passed, " PASS / ", failed, " FAIL")
	get_tree().quit(0 if failed == 0 else 1)
'''
put('check.gd', checks)
print('TEMP fixture:', fixture, flush=True)
subprocess.run([args.godot, '--headless', '--editor', '--path', str(fixture), '--quit'], check=True, stdout=subprocess.DEVNULL)
raise SystemExit(subprocess.run([args.godot, '--headless', '--path', str(fixture), '--quit-after', '180']).returncode)
