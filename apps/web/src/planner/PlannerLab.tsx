import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { assetById, type SceneSpec } from "@house/contracts";
import {
  DesignBriefSchema,
  type DesignBrief,
  type LoopState,
  type RoomView,
  type PlannerReadiness,
} from "@house/aesthetic-planner";
import { editor } from "../state/editor";
import { rooms } from "../state/rooms";
import { readLastRoom } from "../state/lastRoom";
import { cloudRoomIds, cloudRoomsVersion, supabase } from "../state/cloud";
import { CloudAccount } from "../components/CloudAccount";
import type { ModelStatuses } from "./modelStatus";
import { PlannerViewport, type CaptureApi } from "./PlannerViewport";
import "./planner.css";

type Result = LoopState & { id: string; mode?: "live" | "demo" };
export const sampleBrief = (roomId: string): DesignBrief => ({
  schemaVersion: 1,
  roomId,
  styleTags: ["Japanese–Scandinavian", "cozy", "minimal"],
  palette: ["warm white", "sand", "muted earth tones"],
  preferredMaterials: ["pale wood", "textured linen", "ceramic"],
  forms: ["simple", "softly rounded", "low profile"],
  avoid: ["visual clutter", "glossy plastic"],
  priorities: [
    "comfortable seating",
    "clear walking routes",
    "one coherent palette",
  ],
  mustKeepObjectIds: [],
  lightingMood: ["soft", "layered", "reading light near seating"],
  householdNeeds: [
    "Preserve the room's original function and essential furniture",
  ],
  freeText: "Make this room cozy in a Japanese–Scandinavian style.",
});
async function api(path: string, input: unknown): Promise<Result> {
  const { data } = await supabase.auth.getSession();
  const response = await fetch(`/planner-api/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(data.session
        ? { Authorization: `Bearer ${data.session.access_token}` }
        : {}),
    },
    body: JSON.stringify(input),
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      "The planner service did not answer. Check the connection and try again.",
    );
  }
  if (!response.ok)
    throw new Error(body.error ?? "The planner could not finish. Try again.");
  return body;
}
export default function PlannerLab() {
  useStore(cloudRoomsVersion, (s) => s.version);
  const room = useStore(editor.room, (s) => s.room);
  const accepted = useStore(editor.scene, (s) => s.scene);
  const ready = useStore(editor.scene, (s) => s.ready);
  const [base, setBase] = useState<SceneSpec | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [briefText, setBriefText] = useState(
    JSON.stringify(sampleBrief(accepted.roomId), null, 2),
  );
  const [mode, setMode] = useState<"live" | "demo">("live");
  const [before, setBefore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Ready to test the design loop.");
  const [error, setError] = useState("");
  const [readiness, setReadiness] = useState<PlannerReadiness | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [check, setCheck] = useState(0);
  const [authRevision, setAuthRevision] = useState(0);
  const [modelStatus, setModelStatus] = useState<ModelStatuses>({});
  const [views, setViews] = useState<RoomView[]>([]);
  const capture = useRef<CaptureApi>(null);
  const generation = useRef(0);
  useEffect(() => {
    void editor.load(readLastRoom());
  }, []);
  useEffect(() => {
    setBriefText(JSON.stringify(sampleBrief(room.roomId), null, 2));
    setResult(null);
    setBase(null);
    setViews([]);
  }, [room.roomId]);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(() =>
      setAuthRevision((r) => r + 1),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setReadiness(null);
    setConnectionError("");
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const response = await fetch("/planner-api/readiness", {
          headers: data.session
            ? { Authorization: `Bearer ${data.session.access_token}` }
            : {},
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Planner service is unavailable.");
        const state = (await response.json()) as PlannerReadiness;
        if (active) setReadiness(state);
      } catch {
        if (active)
          setConnectionError(
            "The planner service is unavailable. Start it, then check the connection again.",
          );
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [check, authRevision]);
  const show = before
    ? (base ?? accepted)
    : (result?.candidate.scene ?? accepted);
  const shownMode = result?.mode ?? mode;
  const counts = { ready: 0, loading: 0, failed: 0, placeholder: 0 };
  for (const status of Object.values(modelStatus)) counts[status]++;

  async function run() {
    const captured = new Map<string, RoomView[]>();
    setBusy(true);
    setError("");
    setViews([]);
    setBefore(false);
    setResult(null);
    const runId = ++generation.current;
    try {
      const brief = DesignBriefSchema.parse(JSON.parse(briefText));
      const snapshot = structuredClone(editor.scene.getState().scene);
      setBase(snapshot);
      setMessage(
        mode === "demo"
          ? "Running scripted demo fallback…"
          : "Planning your room and requesting models from the render worker…",
      );
      let next = await api("sessions", {
        scene: snapshot,
        shell: room.shell,
        brief,
        mode,
        cloudRoom: cloudRoomIds.has(room.roomId),
        assets: Object.values(assetById),
      });
      for (;;) {
        if (runId !== generation.current) return;
        for (const asset of next.candidate.assets) assetById[asset.id] = asset;
        setResult({ ...next, mode });
        if (next.done) break;
        setMessage(
          `Capturing three views for visual review${next.repairs ? ` after repair ${next.repairs}` : ""}…`,
        );
        // React must commit the candidate before its capture handle is read.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        const candidateViews = await capture.current!.capture();
        captured.set(next.candidate.id, candidateViews);
        setViews(candidateViews);
        setMessage("Reviewing style, composition and usability…");
        next = await api(`sessions/${next.id}/observe`, {
          candidateId: next.candidate.id,
          views: candidateViews,
        });
      }
      setViews(captured.get(next.candidate.id) ?? []);
      setMessage(
        mode === "demo"
          ? "Catalog demo completed. Real furniture is shown below; the design and review are scripted. Your saved room is unchanged."
          : (next.messages.at(-1) ?? "Ready to review."),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not run the planner.");
      setMessage("Experiment stopped. Your saved room is unchanged.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="planner-lab">
      <header>
        <a href="/">← Back to sandbox</a>
        <strong>Design my space</strong>
        <fieldset disabled={busy} className="planner-account">
          <CloudAccount />
        </fieldset>
        <span>
          {shownMode === "demo"
            ? "Catalog demo · real models, scripted design"
            : "Live AI + render worker"}
        </span>
      </header>
      <section className="planner-workspace">
        <aside className="planner-controls">
          <h1>Cozy Japanese–Scandinavian</h1>
          <p>
            A separate design copy. This experiment never saves changes to your
            room.
          </p>
          <label>
            Base room
            <select
              aria-label="Base room"
              value={room.roomId}
              disabled={busy}
              onChange={async (e) => {
                setResult(null);
                setBase(null);
                await editor.switchRoom(e.target.value);
              }}
            >
              {rooms.map((r) => (
                <option key={r.roomId} value={r.roomId}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Run mode
            <select
              aria-label="Run mode"
              value={mode}
              disabled={busy}
              onChange={(e) => setMode(e.target.value as "live" | "demo")}
            >
              <option value="live">Live AI + connected render worker</option>
              <option value="demo">Catalog demo (real furniture)</option>
            </select>
          </label>
          <section
            className="planner-connection"
            aria-label="Furniture connection"
          >
            <strong>
              {connectionError ||
                (mode === "demo" && readiness
                  ? "Ready to show real catalog furniture."
                  : readiness?.message) ||
                "Checking the furniture connection…"}
            </strong>
            {readiness && (
              <p>
                {readiness.catalogCount} real models available from the{" "}
                {readiness.catalogSource === "shared" ? "shared" : "bundled"}{" "}
                catalog.
              </p>
            )}
            <button disabled={busy} onClick={() => setCheck((n) => n + 1)}>
              Check connection
            </button>
          </section>
          <details>
            <summary>
              Furniture instructions ({accepted.objects.length})
            </summary>
            <p>
              Keep may move. Lock protects everything. Replace and Remove are
              instructions.
            </p>
            {accepted.objects.map((o) => (
              <p key={o.id}>
                <strong>{o.displayName}</strong> ·{" "}
                {o.locked
                  ? "Locked — AI won't touch this"
                  : (o.renovationDecision ?? "Planner may change")}
              </p>
            ))}
          </details>
          <label>
            Approved style brief
            <textarea
              aria-label="Approved style brief"
              rows={15}
              value={briefText}
              disabled={busy}
              onChange={(e) => setBriefText(e.target.value)}
            />
          </label>
          <button
            className="primary-pill"
            disabled={
              busy || !ready || (mode === "live" && !readiness?.liveReady)
            }
            onClick={() => void run()}
          >
            {busy ? "Designing…" : "Run design experiment"}
          </button>
          <p role="status">{message}</p>
          {error && (
            <p className="planner-error" role="alert">
              {error}
            </p>
          )}
          <p className="planner-note">
            Accept design and named versions come after this core loop is
            reviewed. Unfinished runs are not restored.
          </p>
        </aside>
        <section className="planner-preview">
          <div className="planner-view-toolbar">
            <button
              disabled={!base || busy}
              aria-pressed={before}
              onClick={() => setBefore(!before)}
            >
              {before ? "Show proposed design" : "Show before"}
            </button>
            <span>
              {before ? "Starting snapshot" : "Proposed design"} · orbit to
              inspect
            </span>
          </div>
          <PlannerViewport
            ref={capture}
            scene={show}
            shell={room.shell}
            onModelStatus={setModelStatus}
          />
          <div className="planner-model-summary" data-testid="model-summary">
            {counts.ready} real models ready · {counts.loading} loading ·{" "}
            {counts.placeholder} placeholders · {counts.failed} failed to load
          </div>
          {result && (
            <div className="planner-report">
              <h2>
                {shownMode === "demo" ? "Catalog demo" : "Design proposal"}
              </h2>
              <p>{result.candidate.plan.rationale}</p>
              <p>
                {result.repairs} repair rounds · {result.history.length} visual
                reviews. Scores are subjective feedback.
              </p>
              {result.history.map((r, i) => (
                <p key={r.candidateId}>
                  Review {i + 1}: {r.score}/15 ·{" "}
                  {r.findings.join("; ") || "No further repairs requested."}
                </p>
              ))}
              <ul>
                {result.candidate.items.map((i) => (
                  <li key={i.key}>
                    <strong>
                      {i.placement === "dropped" ? "Left out" : i.action}:{" "}
                      {i.name}
                    </strong>{" "}
                    ·{" "}
                    {i.matchQuality === "closest_available"
                      ? "Closest available model — check style"
                      : i.method === "placeholder"
                        ? "Labelled placeholder — appearance unverified"
                        : i.method}
                    {i.objectId && modelStatus[i.objectId] === "failed" && (
                      <strong className="planner-error">
                        {" "}
                        · 3D file failed to load
                      </strong>
                    )}
                    {i.objectId && modelStatus[i.objectId] === "loading" && (
                      <span> · Loading 3D file…</span>
                    )}
                    <span>
                      {" "}
                      ·{" "}
                      {i.price.estimatedUnitCost
                        ? `$${(i.price.estimatedUnitCost.minor / 100).toFixed(2)}`
                        : "Price unknown"}
                    </span>
                    {i.notes.map((note, n) => (
                      <small key={n}>{note}</small>
                    ))}
                  </li>
                ))}
              </ul>
              {result.candidate.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
              <details>
                <summary>Actual views sent for review</summary>
                <div className="planner-captures">
                  {views.map((v) => (
                    <img
                      key={v.name}
                      src={v.image}
                      alt={`${v.name} view sent to the reviewer`}
                    />
                  ))}
                </div>
              </details>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
