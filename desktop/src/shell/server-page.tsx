import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRefresh } from "./router";

/**
 * Runs a web page that Next renders on the server (an async function that
 * returns JSX, like web/app/(protected)/map/page.tsx) inside the desktop, and
 * shows what it returns. Its server-only imports resolve to the desktop
 * stand-ins (web-shims/server), so its queries run with the user's session.
 * The page runs again when something asks for fresh data (Aggiorna,
 * router.refresh()); until the first result, `fallback`.
 */
type Props = {
  render: () => Promise<ReactNode> | ReactNode;
  fallback?: ReactNode;
  failure?: ReactNode;
};

type State = { state: "loading" } | { state: "ready"; node: ReactNode } | { state: "failed" };

export default function ServerPage({ render, fallback = null, failure }: Props) {
  const [result, setResult] = useState<State>({ state: "loading" });

  const run = useCallback(() => {
    let live = true;
    Promise.resolve()
      .then(render)
      .then((node) => live && setResult({ state: "ready", node }))
      .catch((error: unknown) => {
        console.error("[desktop] server page failed:", error);
        // A failed refresh keeps what is on screen.
        if (live) setResult((prev) => (prev.state === "ready" ? prev : { state: "failed" }));
      });
    return () => {
      live = false;
    };
    // `render` is a fresh closure every render: the page runs once per mount
    // and on refresh, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(run, [run]);
  useRefresh(run);

  if (result.state === "ready") return <>{result.node}</>;
  if (result.state === "failed")
    return (
      failure ?? (
        <p role="alert" className="max-w-6xl mx-auto px-5 pt-8 text-[12px]" style={{ color: "var(--color-red)" }}>
          Non riesco a leggere questa pagina. Controlla la connessione e premi «Aggiorna».
        </p>
      )
    );
  return <>{fallback}</>;
}
