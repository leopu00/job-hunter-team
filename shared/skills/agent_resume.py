"""Resume acknowledgements: releasing a pause and delivering its order are separate facts."""

from delivery_status import report


def resume(ctx):
    ctx.DETAIL.clear()
    if ctx._halted():
        raise ctx.Refusal("team_halted")
    module = ctx.standby()
    if module.status().get("state") == "off":
        return "not_paused"
    try:
        result = module.wake(why=ctx.RESUME_REASON)
    except Exception:
        report("delivery_state_unavailable", home=ctx.jht_home())
        raise ctx.Refusal("team_resume_failed")
    ctx.DETAIL.update(
        {
            "reached": result.get("reached", []),
            "not_reached": result.get("not_reached", []),
            "pause_removed": bool(result.get("removed")),
        }
    )
    if result.get("not_reached"):
        report("message_not_delivered", home=ctx.jht_home())
        raise ctx.Refusal("team_resume_failed")
    return "resumed" if result.get("removed") else "not_paused"


def resume_agent(ctx, session):
    ctx.DETAIL.clear()
    ctx.parse_session(session)
    module = ctx.agent_pause_module()
    try:
        done = module.resume(session, why=ctx.RESUME_REASON, home=ctx.jht_home())
    except Exception:
        report("delivery_state_unavailable", home=ctx.jht_home())
        raise ctx.Refusal("agent_resume_failed")
    ctx.DETAIL.update({"notified": bool(done.get("notified")), "pause_removed": bool(done.get("removed"))})
    if done.get("removed") and done.get("live") and not done.get("notified"):
        report("message_not_delivered", home=ctx.jht_home())
        raise ctx.Refusal("agent_resume_failed")
    return "agent_resumed" if done.get("removed") else "agent_not_paused"
