import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installApiBridge, shellApi } from "../shell/api-bridge";
import { supabase } from "../lib/supabase";
import { createWebApiFetch } from "../lib/web-api";
import DashboardApp from "./DashboardApp";
import "./dashboard.css";

// Before the first render: the web components may call /api at mount.
installApiBridge(shellApi(createWebApiFetch(supabase)));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DashboardApp />
  </StrictMode>,
);
