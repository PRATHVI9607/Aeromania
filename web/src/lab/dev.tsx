// dev-only harness (not imported by the app): vite dev server at /src/lab/dev.html
import { createRoot } from "react-dom/client";
import "../styles.css";
import "../shell.css";
import "../theme.css";
import { loadData } from "../data";
import Lab from "./Lab";
loadData().then((data) => createRoot(document.getElementById("root")!).render(<Lab data={data} />));
