// Dev-only harness, not imported by the app. Open /src/deep/preview.html?deep=b or ?deep=c on the vite dev server.
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { loadData, type Data } from "../data";
import "../styles.css";
import "../shell.css";
import TrackB from "./TrackB";
import TrackC from "./TrackC";

function P() {
  const [d, setD] = useState<Data | null>(null);
  const [e, setE] = useState("");
  useEffect(() => { loadData().then(setD, (x) => setE(String(x))); }, []);
  const which = new URLSearchParams(location.search).get("deep");
  if (e) return <pre>{e}</pre>;
  if (!d) return <p>loading</p>;
  return <main style={{ padding: 24, height: "auto", overflow: "visible" }}>{which === "c" ? <TrackC data={d} /> : <TrackB data={d} />}</main>;
}
createRoot(document.getElementById("root")!).render(<P />);
