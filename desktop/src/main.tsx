import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AppExitDialog from "./components/AppExitDialog";
import AppMenu from "./components/AppMenu";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <AppExitDialog />
    <AppMenu />
  </StrictMode>,
);
