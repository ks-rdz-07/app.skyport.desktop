import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import { startOsText } from "@/osText";
// Bundled fonts (SIL Open Font License): no font is fetched from the internet.
import "@fontsource-variable/inter";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@/styles.css";
import { applyTheme, getTheme } from "@/theme";

const devTheme = import.meta.env.DEV ? (new URLSearchParams(location.search).get("theme") as "light" | "dark" | null) : null;
applyTheme(devTheme ?? getTheme()); // before first paint, so there is no flash of the wrong theme

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
startOsText(); // macOS/Linux wording
