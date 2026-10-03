import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { supabase } from "../lib/supabase";
import { createWebApiFetch } from "../lib/web-api";
import { mapApi } from "../pages/map/map-api";
import { messagesApi } from "../pages/messages/messages-api";
import { positionsApi } from "../pages/positions/positions-api";
import { teamApi } from "../pages/team/team-api";
import { installApiBridge, shellApi } from "../shell/api-bridge";
import { initializeTheme } from "../shell/theme";
import { DashboardEntrypoint } from "./DashboardEntrypoint";
import "./dashboard.css";

// Before the first render: the web components may call /api at mount.
// Each link answers its routes and hands the rest on; the last one
// (lib/web-api.ts) answers what nobody ported with a JSON 404.
installApiBridge(shellApi(mapApi(positionsApi(messagesApi(teamApi(createWebApiFetch(supabase)))))));
initializeTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DashboardEntrypoint />
  </StrictMode>,
);
