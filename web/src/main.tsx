import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./shell.css";
import "./theme.css";
import { initTheme } from "./theme";
initTheme();
createRoot(document.getElementById("root")!).render(<App />);
