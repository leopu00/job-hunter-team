"""Run the actual shutdown dialog with fake UI services and command runners."""
import json
from pathlib import Path
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]


def test_shutdown_delivery_and_timeout_in_an_isolated_godot_project(tmp_path):
    binary = shutil.which("godot") or "/Applications/Godot.app/Contents/MacOS/Godot"
    if not Path(binary).is_file():
        pytest.skip("Godot is not installed")
    project = tmp_path / "project"
    project.mkdir()
    for relative in (
        "scripts/ui/shutdown_dialog.gd", "scripts/setup/graceful_shutdown_request.gd",
        "tools/shutdown_delivery_selftest.gd",
    ):
        target = project / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if relative == "tools/shutdown_delivery_selftest.gd":
            # A main scene loads after the fake autoloads; --script compiles
            # a SceneTree before those names exist in the isolated project.
            source = (ROOT / "game" / relative).read_text(encoding="utf-8")
            source = source.replace("extends SceneTree", "extends Node").replace("func _init()", "func _ready()")
            source = source.replace("root.add_child(", "get_tree().root.add_child(")
            source = source.replace("await process_frame", "await get_tree().process_frame")
            source = source.replace("\tquit(", "\tget_tree().quit(")
            target.write_text(source, encoding="utf-8")
        else:
            shutil.copyfile(ROOT / "game" / relative, target)
    (project / "services.gd").write_text('''extends Node
var lang := "it"
const VOID := Color.BLACK
const WHITE := Color.WHITE
const YELLOW := Color.YELLOW
const BLUE := Color.BLUE
const RED := Color.RED
const GREEN := Color.GREEN
const MUTED := Color.GRAY
const BASE := Color.WHITE
const MODE_CANCEL := "cancel"
const MODE_FORCED := "forced"
const MODE_GRACEFUL := "graceful"
const MODE_DETACH := "detach"
func t(key: String) -> String:
    if key == "shutdown.lead": return "%d agents"
    if key == "shutdown.waiting": return "%d agents %d seconds"
    return key
func display_name(value: String) -> String: return value
func get_theme() -> Theme: return Theme.new()
func label(text: String, _size: int, _color: Color, _weight := "") -> Label:
    var node := Label.new()
    node.text = text
    return node
func play_blip() -> void: pass
func warn(_category: String, _text: String) -> void: pass
func request_graceful_shutdown() -> bool: return false
func graceful_shutdown_ready() -> bool: return false
func active_agents() -> PackedStringArray: return PackedStringArray()
''', encoding="utf-8")
    (project / "panel.gd").write_text("class_name BracketPanel\nextends PanelContainer\n", encoding="utf-8")
    aliases = ("UIStrings", "Palette", "TerminalTheme", "AgentNames", "Sfx", "Log", "SetupService", "HeadlessSession")
    config = ('config_version=5\n[application]\nconfig/name="Shutdown Fixture"\n'
              'run/main_scene="res://runner.tscn"\n'
              'config/use_custom_user_dir=true\nconfig/custom_user_dir='
              + json.dumps(str(tmp_path / "user")) + '\n[autoload]\n')
    config += "\n".join(f'{name}="*res://services.gd"' for name in aliases)
    (project / "project.godot").write_text(config, encoding="utf-8")
    (project / "runner.tscn").write_text('[gd_scene load_steps=2 format=3]\n'
        '[ext_resource type="Script" path="res://tools/shutdown_delivery_selftest.gd" id="1"]\n'
        '[node name="Runner" type="Node"]\nscript = ExtResource("1")\n', encoding="utf-8")
    imported = subprocess.run([binary, "--headless", "--path", str(project), "--editor", "--import", "--quit"],
                              capture_output=True, text=True, timeout=90)
    assert imported.returncode == 0, imported.stdout + imported.stderr
    assert "SCRIPT ERROR" not in imported.stderr, imported.stdout + imported.stderr
    result = subprocess.run([binary, "--headless", "--path", str(project)],
                            capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "SHUTDOWN-DELIVERY-TEST PASS" in result.stdout, result.stdout + result.stderr
