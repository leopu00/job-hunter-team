import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { appLocale } from "../lib/app-locale";
import { readOnce, withReadDeadline } from "../lib/read-deadline";
import CloudDataNotice, { useCloudDataBlocked } from "./CloudDataNotice";
import { useLocalTeamData } from "../lib/local-team-data";
import { SHELL_TEXT } from "./shell.i18n";
import { useLocation, useRefresh } from "./router";
import { dataShown } from "../lib/page-timing";

/**
 * Runs a web page that Next renders on the server (an async function that
 * returns JSX, like web/app/(protected)/map/page.tsx) inside the desktop, and
 * shows what it returns. Its server-only imports resolve to the desktop
 * stand-ins (web-shims/server), so its queries run with the user's session.
 * The page runs again when something asks for fresh data (Aggiorna,
 * router.refresh()), and when `runKey` changes (a page whose query string
 * holds its filters): the screen stays up until the new result replaces it,
 * as a Next soft navigation does, so the client components keep their state.
 * Until the first result, `fallback`; a page that gives none within the read deadline says it
 * could not be read, with a button to try again, instead of staying a skeleton.
 */
type Props = {
  render: () => Promise<ReactNode> | ReactNode;
  fallback?: ReactNode;
  failure?: ReactNode;
  runKey?: string;
};

type ReadSource = "native" | "cloud";
type State = { state: "loading" } | {
  state: "ready"; node: ReactNode; key: string; run: number; source: ReadSource;
} | { state: "failed" };

function usePageResult(render: Props["render"], readKey: string, source: ReadSource) {
  const [result, setResult] = useState<State>({ state: "loading" });
  const currentRun = useRef(0);
  const latest = useRef({ render, key: readKey, source });
  latest.current = { render, key: readKey, source };
  const run = useCallback(() => {
    const request = latest.current;
    const id = ++currentRun.current;
    const current = () => currentRun.current === id && latest.current.key === request.key;
    withReadDeadline(readOnce(request.key, () => Promise.resolve().then(request.render)))
      .then((node) => {
        if (current()) setResult({ state: "ready", node, key: request.key, run: id, source: request.source });
      })
      .catch((error: unknown) => {
        console.error("[desktop] server page failed:", error);
        // A failed refresh keeps what is on screen.
        if (current()) setResult((prev) => (prev.state === "ready" ? prev : { state: "failed" }));
      });
  }, []);
  useEffect(() => {
    run();
    // Also cancels a refresh whose cleanup is not retained by useRefresh.
    return () => { currentRun.current += 1; };
  }, [run, readKey]);
  useRefresh(run);
  const retry = useCallback(() => { setResult({ state: "loading" }); run(); }, [run]);
  return { result, retry, currentRun };
}

function useFirstShown(result: State, readKey: string, pageSession: string, blocked: boolean, currentRun: { readonly current: number }) {
  const shown = useRef({ session: pageSession, done: false });
  useEffect(() => {
    if (shown.current.session !== pageSession) shown.current = { session: pageSession, done: false };
    if (blocked || result.state !== "ready" || result.key !== readKey || result.run !== currentRun.current || shown.current.done) return;
    shown.current.done = true;
    dataShown(result.source);
  }, [result, readKey, pageSession, blocked, currentRun]);
}

export default function ServerPage({ render, fallback = null, failure, runKey }: Props) {
  // Both hooks always run: a cloud session can come and go under this page.
  const localTeam = useLocalTeamData();
  const blocked = useCloudDataBlocked() && !localTeam;
  const { path, search } = useLocation();
  const readKey = `server-page:${path}?${runKey ?? ""}`;
  const { result, retry, currentRun } = usePageResult(render, readKey, localTeam ? "native" : "cloud");
  useFirstShown(result, readKey, `${path}?${search}`, blocked, currentRun);

  // Nothing to read with: the page is the notice, not its own empty states.
  if (blocked) return <CloudDataNotice />;
  if (result.state === "ready") return result.node;
  if (result.state === "failed")
    return (
      <>
        {failure ?? (
          <p role="alert" className="max-w-6xl mx-auto px-5 pt-8 text-[12px]" style={{ color: "var(--color-red)" }}>
            {SHELL_TEXT[appLocale()].pageReadFailed(SHELL_TEXT[appLocale()].refresh)}
          </p>
        )}
        <div className="max-w-6xl mx-auto px-5 pt-3">
          <button type="button" className="border border-[var(--color-border)] rounded px-3 py-1.5 text-[12px]" onClick={retry}>
            {SHELL_TEXT[appLocale()].retry}
          </button>
        </div>
      </>
    );
  return <>{fallback}</>;
}
