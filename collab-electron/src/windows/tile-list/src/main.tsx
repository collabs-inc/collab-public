import { createRoot } from "react-dom/client";
import { initDarkMode } from "@collab/shared/dark-mode";
import "@collab/shared/styles/Theme.css";
import App from "./App";

initDarkMode();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
