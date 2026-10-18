import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { assetById, type SceneSpec } from "@house/contracts";
import {
  DesignBriefSchema,
  type DesignBrief,
  type LoopState,
  type RoomView,
} from "@house/aesthetic-planner";
import { editor } from "../state/editor";
import { rooms } from "../state/rooms";
import { readLastRoom } from "../state/lastRoom";
import { cloudRoomIds, supabase } from "../state/cloud";
import { PlannerViewport, type CaptureApi } from "./PlannerViewport";
import "./planner.css";

type Result = LoopState & { id: string };
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
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? "The planner could not finish. Try again.");
  return body;
}
export default function PlannerLab() {
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
  const [views, setViews] = useState<RoomView[]>([]);
  const capture = useRef<CaptureApi>(null);
  const generation = useRef(0);
  useEffect(() => {
    void editor.load(readLastRoom());
  }, []);
  useEffect(() => {
    setBriefText(JSON.stringify(sampleBrief(room.roomId), null, 2));
  }, [room.roomId]);
  const show = before
    ? (base ?? accepted)
    : (result?.candidate.scene ?? accepted);

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
        setResult(next);
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
      setMessage(next.messages.at(-1) ?? "Ready to review.");
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
        <strong>Design my space · first experiment</strong>
        <span>
          {mode === "demo"
            ? "Demo fallback · scripted"
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
              <option value="demo">Demo fallback (scripted)</option>
            </select>
          </label>
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
            disabled={busy || !ready}
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
          <PlannerViewport ref={capture} scene={show} shell={room.shell} />
          {result && (
            <div className="planner-report">
              <h2>{mode === "demo" ? "Demo fallback" : "Design proposal"}</h2>
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
                    {i.method === "placeholder"
                      ? "Labelled placeholder — appearance unverified"
                      : i.method}
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
