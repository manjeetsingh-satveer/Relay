import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthGate } from "./Auth";
import { CloudLauncher } from "./Cloud";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {location.hash === "#cloud" ? (
      <CloudLauncher />
    ) : (
      <AuthGate>
        <App />
      </AuthGate>
    )}
  </StrictMode>,
);
