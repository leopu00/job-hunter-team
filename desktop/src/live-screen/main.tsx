import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrokerLoginViewer } from "./BrokerLoginViewer";
import { LiveScreenViewer } from "./LiveScreenViewer";
import "../styles.css";
import "./live-screen.css";

const root = createRoot(document.getElementById("root")!);
if (new URLSearchParams(window.location.search).get("view") === "broker-login") {
  // No StrictMode here: its second mount in development would ask again for a
  // token that is good for one connection only.
  root.render(<BrokerLoginViewer />);
} else {
  root.render(
    <StrictMode>
      <LiveScreenViewer />
    </StrictMode>,
  );
}
