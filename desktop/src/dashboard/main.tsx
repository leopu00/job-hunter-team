import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installApiBridge, notInDesktop, shellApi } from "../shell/api-bridge";
import DashboardApp from "./DashboardApp";
import "./dashboard.css";

// Before the first render: the web components may call /api at mount.
installApiBridge(shellApi(notInDesktop));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DashboardApp />
  </StrictMode>,
);
