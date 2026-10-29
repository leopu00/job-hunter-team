import { localTeamApi } from "../pages/team/local-team-api";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { supabase } from "../lib/supabase";
import { directExclusionsApi } from "../lib/profile-exclusions-direct";
import { createWebApiFetch } from "../lib/web-api";
import { localJudgementApi } from "../lib/local-judgement-api";
import { vpsJudgementApi } from "../lib/vps-judgement-api";
import { mapApi } from "../pages/map/map-api";
import { messagesApi } from "../pages/messages/messages-api";
import { positionsApi } from "../pages/positions/positions-api";
import { teamApi } from "../pages/team/team-api";
import { installCookieMirror } from "../lib/cookie-mirror";
import { installCsvExport } from "../lib/export-csv";
import { installDocumentPreview, installDocumentSave } from "../lib/team-document";
import { installApiBridge, shellApi } from "../shell/api-bridge";
import { initializeTheme } from "../shell/theme";
import AppExitDialog from "../components/AppExitDialog";
import AppMenu from "../components/AppMenu";
import { DashboardEntrypoint } from "./DashboardEntrypoint";
import "./dashboard.css";

// The page cookies (columns, currency, language) survive where WKWebView drops them (lib/cookie-mirror.ts).
installCookieMirror();

// Before the first render: the web components may call /api at mount.
// Each link answers its routes and hands the rest on; the last one
// (lib/web-api.ts) answers what nobody ported with a JSON 404. The judgement on a position goes to
// the VPS first when the team is an existing one connected in full (lib/vps-judgement-api.ts), and to the team
// on this computer when the profile has no cloud account (lib/local-judgement-api.ts).
installApiBridge(shellApi(localTeamApi(localJudgementApi(vpsJudgementApi(mapApi(positionsApi(messagesApi(teamApi(directExclusionsApi(createWebApiFetch(supabase), supabase))))))))));
initializeTheme();
installCsvExport();
installDocumentSave();
installDocumentPreview();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DashboardEntrypoint />
    <AppExitDialog />
    <AppMenu />
  </StrictMode>,
);
