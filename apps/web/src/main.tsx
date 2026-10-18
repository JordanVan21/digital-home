import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "./styles.css";
const GeometryLab = lazy(() => import("./geometry-lab/GeometryLab"));
const experiment = new URLSearchParams(window.location.search).has(
  "geometry-lab",
);
createRoot(document.getElementById("root")!).render(
  experiment ? (
    <Suspense fallback={<p>Loading geometry experiment…</p>}>
      <GeometryLab />
    </Suspense>
  ) : (
    <App />
  ),
);
