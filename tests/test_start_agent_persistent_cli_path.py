from pathlib import Path


def test_start_agent_serializes_before_rewriting_agent_skills():
    launcher = Path(__file__).parents[1] / ".launcher"
    source = (launcher / "start-agent.sh").read_text(encoding="utf-8")
    spawn_lib = (launcher / "spawn-lib.sh").read_text(encoding="utf-8")
    # L'attesa del lock e' una env var con default (JHT_SPAWN_LOCK_WAIT_SEC) e
    # il target del guard e' ancorato con `=` (exact match): qui conta
    # l'ORDINE lock -> idempotenza -> riscrittura delle skill, non i valori.
    lock = source.index('flock -w "$JHT_SPAWN_LOCK_WAIT_SEC" 9')
    early_idempotence = source.index('tmux has-session -t "=$SESSION"', lock)
    skill_sync = source.index("jht_spawn_copy_skills \\", early_idempotence)

    assert 'rm -rf "$workdir/.claude/skills" "$workdir/.agents/skills"' in spawn_lib
    assert lock < early_idempotence < skill_sync
