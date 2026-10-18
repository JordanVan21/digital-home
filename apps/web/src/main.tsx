import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { loadCloudLibrary, loadCloudRooms } from "./state/cloud";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "./styles.css";
const GeometryLab = lazy(() => import("./geometry-lab/GeometryLab"));
const ThumbnailStudio = lazy(
  () => import("./thumbnail-studio/ThumbnailStudio"),
);
const params = new URLSearchParams(window.location.search);
const experiment = params.has("geometry-lab");
const thumbnail = import.meta.env.DEV && params.get("thumbnail-studio");
// Load the shared asset library and the signed-in user's scanned rooms before the
// first render, so the last-opened scanned room can reopen. Never wait long:
// offline, the bundled rooms and models still work.
await Promise.race([
  Promise.all([loadCloudLibrary(), loadCloudRooms()]).catch(() => undefined),
  new Promise((resolve) => setTimeout(resolve, 4000)),
]);
createRoot(document.getElementById("root")!).render(
  thumbnail ? (
    <Suspense fallback={null}>
      <ThumbnailStudio assetId={thumbnail} />
    </Suspense>
  ) : experiment ? (
    <Suspense fallback={<p>Loading geometry experiment…</p>}>
      <GeometryLab />
    </Suspense>
  ) : (
    <App />
  ),
);
