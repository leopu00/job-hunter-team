import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LiveScreenViewer } from "./LiveScreenViewer";
import "../styles.css";
import "./live-screen.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LiveScreenViewer />
  </StrictMode>,
);
