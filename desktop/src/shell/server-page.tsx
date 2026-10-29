import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { appLocale } from "../lib/app-locale";
import { readOnce, withReadDeadline } from "../lib/read-deadline";
import CloudDataNotice, { useCloudDataBlocked } from "./CloudDataNotice";
import { useLocalTeamData } from "../lib/local-team-data";
import { SHELL_TEXT } from "./shell.i18n";
import { useLocation, useRefresh } from "./router";

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

type State = { state: "loading" } | { state: "ready"; node: ReactNode } | { state: "failed" };

export default function ServerPage({ render, fallback = null, failure, runKey }: Props) {
  const [result, setResult] = useState<State>({ state: "loading" });
  // A local profile's team is read from this computer (the shims answer from its database): nothing to block.
  // Both hooks run on every render (never one inside the `&&`): the cloud session can come and go under the page.
  const localTeam = useLocalTeamData();
  const blocked = useCloudDataBlocked() && !localTeam;
  const { path } = useLocation();
  // what is read, for the page and its filters: asking again while this read runs waits for it
  const readKey = `server-page:${path}?${runKey ?? ""}`;
  const keyRef = useRef(readKey);
  keyRef.current = readKey;
  // The latest closure: a run started by runKey or refresh reads the props of now.
  const latest = useRef(render);
  latest.current = render;

  const run = useCallback(() => {
    let live = true;
    withReadDeadline(readOnce(keyRef.current, () => Promise.resolve().then(() => latest.current())))
      .then((node) => live && setResult({ state: "ready", node }))
      .catch((error: unknown) => {
        console.error("[desktop] server page failed:", error);
        // A failed refresh keeps what is on screen.
        if (live) setResult((prev) => (prev.state === "ready" ? prev : { state: "failed" }));
      });
    return () => {
      live = false;
    };
    // `render` is a fresh closure every render: the page runs once per mount,
    // on refresh and on a new runKey, not on every re-render.
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(run, [run, runKey]);
  useRefresh(run);

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
          <button type="button" className="border border-[var(--color-border)] rounded px-3 py-1.5 text-[12px]" onClick={() => { setResult({ state: "loading" }); run(); }}>
            {SHELL_TEXT[appLocale()].retry}
          </button>
        </div>
      </>
    );
  return <>{fallback}</>;
}
