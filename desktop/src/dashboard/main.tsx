import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { supabase } from "../lib/supabase";
import { createWebApiFetch } from "../lib/web-api";
import { mapApi } from "../pages/map/map-api";
import { installApiBridge, shellApi } from "../shell/api-bridge";
import DashboardApp from "./DashboardApp";
import "./dashboard.css";

// Before the first render: the web components may call /api at mount.
// Each link answers its routes and hands the rest on; the last one
// (lib/web-api.ts) answers what nobody ported with a JSON 404.
installApiBridge(shellApi(mapApi(createWebApiFetch(supabase))));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DashboardApp />
  </StrictMode>,
);
