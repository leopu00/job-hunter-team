import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AppExitDialog from "./components/AppExitDialog";
import AppMenu from "./components/AppMenu";
import { installCookieMirror } from "./lib/cookie-mirror";
import "./styles.css";

// The first screen (the language) is on this page and the dashboard is on the next: both must keep and read the
// choice through the same mirror, or an old language kept by one of them wins over the one just made (lib/cookie-mirror.ts).
installCookieMirror();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <AppExitDialog />
    <AppMenu />
  </StrictMode>,
);
