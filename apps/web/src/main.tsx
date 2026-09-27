import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { DeveloperVoicePanel } from "./components/DeveloperVoicePanel";
import "./styles.css";

const workerUrl = import.meta.env.VITE_WORKER_URL || (import.meta.env.DEV ? "http://localhost:8787" : "");
const page = window.location.pathname === "/developer/voices"
  ? <DeveloperVoicePanel workerUrl={workerUrl} />
  : <App />;

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {page}
  </React.StrictMode>
);
