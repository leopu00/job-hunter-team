import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { mapApi } from "../pages/map/map-api";
import { installApiBridge, notInDesktop, shellApi } from "../shell/api-bridge";
import DashboardApp from "./DashboardApp";
import "./dashboard.css";

// Before the first render: the web components may call /api at mount.
// Each link answers its routes and hands the rest on; what nobody answers
// is a JSON 404 (not_in_desktop).
installApiBridge(shellApi(mapApi(notInDesktop)));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DashboardApp />
  </StrictMode>,
);
