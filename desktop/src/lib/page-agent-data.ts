import { readPanelList, readTeamState, readPanelHistory, type Outcome } from "./agent-control";
import { usePageData } from "./use-page-data";

async function value<T>(read: Promise<Outcome<T>>): Promise<T> {
  const result = await read;
  if (!result.ok) throw { code: result.code };
  return result.value;
}

function result<T>(data: T | undefined, error: { code: string } | null, at: number | null): Outcome<T> | null {
  return data !== undefined ? { ok: true, value: data, at: at! } : error ? { ok: false, code: error.code, at: Date.now() } : null;
}

export function usePageAgents(enabled: boolean) {
  const check = <T,>(load: () => Promise<Outcome<T>>) => {
    if (!enabled) return Promise.reject({ code: "agent_control_invalid" });
    return value(load());
  };
  const params = enabled ? {} : { inactive: true };
  const listed = usePageData("agents", "list", params, () => check(readPanelList), true, enabled);
  const team = usePageData("agents", "team", params, () => check(readTeamState), false, enabled);
  const past = usePageData("agents", "history", params, () => check(readPanelHistory), false, enabled);
  return {
    list: result(listed.data, listed.error, listed.at), team: team.data ?? null,
    history: result(past.data, past.error, past.at), now: listed.at ?? Date.now(),
    at: listed.at, error: listed.error ?? team.error ?? past.error, refresh: listed.refresh,
  };
}
