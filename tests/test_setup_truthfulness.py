"""Contratti di verità visiva durante setup e team fermo.

Il run Windows del 2026-08-03 mostrava KPI demo e sedici etichette
``AL LAVORO`` mentre il setup era 1/4 e nessuna sessione LLM esisteva. Il
badge che avrebbe dichiarato la simulazione era coperto dal CTA del setup.
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def _src(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def test_setup_cta_does_not_cover_truth_badge():
    sidebar = _src("game/scripts/ui/game_sidebar.gd")
    badge = _src("game/scripts/ui/sim_badge.gd")
    assert "Vector2(-190, 58)" in sidebar
    assert "position = Vector2((get_parent_area_size().x - size.x) / 2.0, 14)" in badge


def test_truth_badge_tracks_demo_data_not_only_connection():
    badge = _src("game/scripts/ui/sim_badge.gd")
    assert "BackendBus.positions_updated.connect" in badge
    assert "BackendBus.is_live() and not BackendBus.positions_are_demo" in badge


def test_live_empty_database_never_falls_back_to_mock_kpis():
    hud = _src("game/scripts/office/team_hud.gd")
    assert "BackendBus.is_live() and not BackendBus.positions_are_demo" in hud
    assert "BackendBus.kpi_summary()" in hud


def test_showroom_agents_wait_until_operational_team_exists():
    office = _src("game/scripts/office/office.gd")
    assert 'var team_running := bool(status.get("team_running", false))' in office
    assert 'agent.set_backend_status("working" if team_running else "idle")' in office
