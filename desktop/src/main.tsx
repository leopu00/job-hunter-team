import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AppExitDialog from "./components/AppExitDialog";
import AppMenu from "./components/AppMenu";
import PageErrorBoundary from "./shell/PageErrorBoundary";
import { installCookieMirror } from "./lib/cookie-mirror";
import { installExternalLinks } from "./lib/external-links";
import "./styles.css";

// The first screen (the language) is on this page and the dashboard is on the next: both must keep and read the
// choice through the same mirror, or an old language kept by one of them wins over the one just made (lib/cookie-mirror.ts).
installCookieMirror();

// A link to the outside opens in the person's browser: the webview drops a new-window request (lib/external-links.ts).
installExternalLinks();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* A screen that breaks while it is drawn (the setup has no shell around it) would leave the window blank: here it
        says so and offers to start again. Without it nothing marks the failure and even the close button waits for a page that is gone. */}
    <PageErrorBoundary onHome={() => window.location.reload()}>
      <App />
    </PageErrorBoundary>
    <AppExitDialog />
    <AppMenu />
  </StrictMode>,
);
