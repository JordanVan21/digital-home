import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { ArrowLeft, Check, Loader2, RefreshCw, Sparkles } from "lucide-react";
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
type Stage = "idle" | "plan" | "capture" | "review" | "done" | "error";

/** A look the user can pick; swatches are display-only, the brief uses the words. */
type StylePreset = {
  id: string;
  name: string;
  blurb: string;
  swatches: string[];
  brief: Omit<
    DesignBrief,
    "schemaVersion" | "roomId" | "mustKeepObjectIds" | "householdNeeds"
  >;
};
export const stylePresets: StylePreset[] = [
  {
    id: "japandi",
    name: "Cozy Japanese–Scandinavian",
    blurb: "Pale wood, linen and soft, low light.",
    swatches: ["#f3eee4", "#d8c3a5", "#b08a5e", "#4a4640"],
    brief: {
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
      lightingMood: ["soft", "layered", "reading light near seating"],
      freeText: "Make this room cozy in a Japanese–Scandinavian style.",
    },
  },
  {
    id: "midcentury",
    name: "Mid-century modern",
    blurb: "Walnut, tapered legs and warm accent colors.",
    swatches: ["#efe6d2", "#6b4429", "#d4a23c", "#2f6f6b"],
    brief: {
      styleTags: ["mid-century modern", "retro", "warm"],
      palette: ["cream", "walnut brown", "mustard", "deep teal"],
      preferredMaterials: ["walnut", "leather", "brass", "wool"],
      forms: ["tapered legs", "clean lines", "organic curves"],
      avoid: ["heavy ornament", "chrome"],
      priorities: ["a statement chair", "conversation seating", "warm light"],
      lightingMood: ["warm", "globe and arc lamps"],
      freeText: "Give this room a warm mid-century modern look.",
    },
  },
  {
    id: "coastal",
    name: "Coastal calm",
    blurb: "Airy whites, sea-glass blues and driftwood.",
    swatches: ["#f7f5f0", "#a9c6c1", "#b9a58a", "#2e4057"],
    brief: {
      styleTags: ["coastal", "airy", "relaxed"],
      palette: ["white", "sea-glass blue", "driftwood", "navy accents"],
      preferredMaterials: ["whitewashed wood", "rattan", "cotton", "jute"],
      forms: ["relaxed", "slipcovered", "light frames"],
      avoid: ["dark heavy furniture", "visual clutter"],
      priorities: ["bright and open", "comfortable seating", "natural texture"],
      lightingMood: ["bright", "natural daylight feel"],
      freeText: "Make this room feel bright, airy and coastal.",
    },
  },
  {
    id: "warm-minimal",
    name: "Warm minimal",
    blurb: "Calm neutrals, stone and a few black accents.",
    swatches: ["#f4f1ea", "#cfc6b8", "#a89a87", "#1f1f1f"],
    brief: {
      styleTags: ["warm minimal", "calm", "modern"],
      palette: ["ivory", "greige", "travertine", "black accents"],
      preferredMaterials: ["travertine", "oak", "boucle", "matte black metal"],
      forms: ["sculptural", "rounded", "clean lines"],
      avoid: ["visual clutter", "bright saturated colors"],
      priorities: ["one sculptural focal piece", "open floor", "calm palette"],
      lightingMood: ["soft", "indirect"],
      freeText: "Make this room calm and warm-minimal.",
    },
  },
  {
    id: "boho",
    name: "Boho eclectic",
    blurb: "Terracotta, rattan, plants and layered textiles.",
    swatches: ["#efe3d0", "#c56a3e", "#7d8450", "#a67c52"],
    brief: {
      styleTags: ["bohemian", "eclectic", "layered"],
      palette: ["cream", "terracotta", "olive green", "warm tan"],
      preferredMaterials: ["rattan", "macrame", "terracotta", "patterned wool"],
      forms: ["low lounging", "organic", "layered textiles"],
      avoid: ["sterile minimalism", "glossy plastic"],
      priorities: ["plants", "cozy lounge seating", "rich textures"],
      lightingMood: ["warm", "lantern-like", "layered"],
      freeText: "Make this room a relaxed, plant-filled boho space.",
    },
  },
];
const briefFor = (
  preset: StylePreset,
  roomId: string,
  notes: string,
): DesignBrief => ({
  schemaVersion: 1,
  roomId,
  ...preset.brief,
  mustKeepObjectIds: [],
  householdNeeds: [
    "Preserve the room's original function and essential furniture",
  ],
  freeText: notes.trim()
    ? `${preset.brief.freeText} ${notes.trim()}`
    : preset.brief.freeText,
});
export const sampleBrief = (roomId: string): DesignBrief =>
  briefFor(stylePresets[0], roomId, "");

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

const actionLabel: Record<string, string> = {
  add: "Add",
  replace: "Replace",
  keep: "Keep",
  move: "Move",
  remove: "Remove",
};
const methodLabel: Record<string, string> = {
  existing: "Your piece",
  retrieved: "From the library",
  edited: "Edited model",
  generated: "Built for you",
  placeholder: "Placeholder",
};
const money = (minor: number) =>
  `$${(minor / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export default function PlannerLab() {
  useStore(cloudRoomsVersion, (s) => s.version);
  const room = useStore(editor.room, (s) => s.room);
  const accepted = useStore(editor.scene, (s) => s.scene);
  const ready = useStore(editor.scene, (s) => s.ready);
  const [base, setBase] = useState<SceneSpec | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [presetId, setPresetId] = useState(stylePresets[0].id);
  const [notes, setNotes] = useState("");
  const preset = stylePresets.find((p) => p.id === presetId)!;
  const [briefText, setBriefText] = useState(
    JSON.stringify(sampleBrief(accepted.roomId), null, 2),
  );
  const [mode, setMode] = useState<"live" | "demo">("live");
  const [before, setBefore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [message, setMessage] = useState("Pick a style, then design.");
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
    setResult(null);
    setBase(null);
    setViews([]);
    setStage("idle");
  }, [room.roomId]);
  // The style cards and notes write the brief; Advanced can still edit it by hand.
  useEffect(() => {
    setBriefText(JSON.stringify(briefFor(preset, room.roomId, notes), null, 2));
  }, [preset, room.roomId, notes]);
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
  const connectionOk = connectionError
    ? false
    : mode === "demo"
      ? !!readiness
      : !!readiness?.liveReady;
  const connectionText =
    connectionError ||
    (mode === "demo" && readiness
      ? "Ready to show real catalog furniture."
      : readiness?.message) ||
    "Checking the furniture connection…";

  async function run() {
    const captured = new Map<string, RoomView[]>();
    setBusy(true);
    setError("");
    setViews([]);
    setBefore(false);
    setResult(null);
    setStage("plan");
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
        setStage("capture");
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
        setStage("review");
        setMessage("Reviewing style, composition and usability…");
        next = await api(`sessions/${next.id}/observe`, {
          candidateId: next.candidate.id,
          views: candidateViews,
        });
      }
      setViews(captured.get(next.candidate.id) ?? []);
      setStage("done");
      setMessage(
        mode === "demo"
          ? "Catalog demo completed. Real furniture is shown below; the design and review are scripted. Your saved room is unchanged."
          : (next.messages.at(-1) ?? "Ready to review."),
      );
    } catch (e) {
      setStage("error");
      setError(e instanceof Error ? e.message : "Could not run the planner.");
      setMessage("Experiment stopped. Your saved room is unchanged.");
    } finally {
      setBusy(false);
    }
  }

  const steps: { key: Stage; label: string }[] = [
    { key: "plan", label: "Plan the room and find furniture" },
    { key: "capture", label: "Render the proposal" },
    { key: "review", label: "Review and refine the look" },
  ];
  const order: Stage[] = ["plan", "capture", "review", "done"];
  const stepState = (key: Stage) => {
    if (stage === "done") return "done";
    if (stage === "idle" || stage === "error") return "todo";
    const at = order.indexOf(stage);
    const own = order.indexOf(key);
    return own < at ? "done" : own === at ? "active" : "todo";
  };
  const items = result?.candidate.items ?? [];
  const changes = items.filter((i) => i.action !== "keep");
  const newCost = items
    .filter((i) => i.action === "add" || i.action === "replace")
    .reduce((sum, i) => sum + (i.price.estimatedUnitCost?.minor ?? 0), 0);
  const unknownPrices = items.filter(
    (i) =>
      (i.action === "add" || i.action === "replace") &&
      !i.price.estimatedUnitCost,
  ).length;

  return (
    <main className={`planner-lab${result ? " has-report" : ""}`}>
      <PlannerViewport
        ref={capture}
        scene={show}
        shell={room.shell}
        onModelStatus={setModelStatus}
      />

      <header className="planner-topbar glass">
        <a className="planner-back glass-button" href="/">
          <ArrowLeft size={16} />
          <span>Sandbox</span>
        </a>
        <strong className="planner-title">
          <Sparkles size={17} /> Design my space
        </strong>
        <div className="spacer" />
        <label className="planner-room-pill glass-inset">
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
        <fieldset disabled={busy} className="planner-account">
          <CloudAccount />
        </fieldset>
      </header>

      <aside className="planner-panel planner-controls glass">
        <p className="planner-eyebrow">Style</p>
        <h1>{preset.name}</h1>
        <p className="planner-sub">
          Pick a look and the planner redesigns this room as a separate copy.
          Your saved room stays exactly as it is.
        </p>

        <div className="style-grid" role="radiogroup" aria-label="Style">
          {stylePresets.map((p) => (
            <button
              key={p.id}
              role="radio"
              aria-checked={p.id === presetId}
              className={`style-card${p.id === presetId ? " selected" : ""}`}
              disabled={busy}
              onClick={() => setPresetId(p.id)}
            >
              <span className="swatches">
                {p.swatches.map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </span>
              <strong>{p.name}</strong>
              <small>{p.blurb}</small>
            </button>
          ))}
        </div>

        <label className="planner-field">
          Anything specific?
          <textarea
            rows={2}
            value={notes}
            disabled={busy}
            placeholder="e.g. add plants, a reading corner, keep my desk"
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        <label className="planner-field">
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
          className={`planner-connection ${connectionOk ? "ok" : "wait"}`}
          aria-label="Furniture connection"
        >
          <i className="dot" />
          <div>
            <strong>{connectionText}</strong>
            {readiness && (
              <p>
                {readiness.catalogCount} real models available from the{" "}
                {readiness.catalogSource === "shared" ? "shared" : "bundled"}{" "}
                catalog.
              </p>
            )}
          </div>
          <button
            className="round glass-button"
            aria-label="Check connection"
            title="Check connection"
            disabled={busy}
            onClick={() => setCheck((n) => n + 1)}
          >
            <RefreshCw size={14} />
          </button>
        </section>

        <button
          className="primary-pill planner-go"
          disabled={
            busy || !ready || (mode === "live" && !readiness?.liveReady)
          }
          onClick={() => void run()}
        >
          {busy ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <Sparkles size={16} />
          )}
          <span>{busy ? "Designing…" : "Run design experiment"}</span>
        </button>

        {stage !== "idle" && (
          <ol className="planner-steps">
            {steps.map((s) => (
              <li key={s.key} className={stepState(s.key)}>
                <span className="step-dot">
                  {stepState(s.key) === "done" ? (
                    <Check size={12} />
                  ) : stepState(s.key) === "active" ? (
                    <Loader2 size={12} className="spin" />
                  ) : null}
                </span>
                {s.label}
              </li>
            ))}
          </ol>
        )}
        <p className="planner-status" role="status">
          {message}
        </p>
        {error && (
          <p className="planner-error" role="alert">
            {error}
          </p>
        )}

        <details className="planner-advanced">
          <summary>Advanced</summary>
          <p>
            Furniture instructions ({accepted.objects.length}). Keep may move.
            Lock protects everything. Replace and Remove are instructions.
          </p>
          {accepted.objects.map((o) => (
            <p key={o.id}>
              <strong>{o.displayName}</strong> ·{" "}
              {o.locked
                ? "Locked — AI won't touch this"
                : (o.renovationDecision ?? "Planner may change")}
            </p>
          ))}
          <label className="planner-field">
            Approved style brief
            <textarea
              aria-label="Approved style brief"
              rows={12}
              value={briefText}
              disabled={busy}
              onChange={(e) => setBriefText(e.target.value)}
            />
          </label>
        </details>
      </aside>

      <div className="planner-compare">
        <div className="segmented glass" role="group" aria-label="Compare">
          <button
            aria-pressed={before}
            className={before ? "on" : ""}
            disabled={!base || busy}
            onClick={() => setBefore(true)}
          >
            Before
          </button>
          <button
            aria-pressed={!before}
            className={!before ? "on" : ""}
            disabled={!base || busy}
            onClick={() => setBefore(false)}
          >
            After
          </button>
        </div>
        <span className="planner-caption">
          {before ? "Starting snapshot" : "Proposed design"} · orbit to inspect
        </span>
        <span className="planner-model-summary" data-testid="model-summary">
          {counts.ready} real models ready · {counts.loading} loading ·{" "}
          {counts.placeholder} placeholders · {counts.failed} failed to load
        </span>
      </div>

      {result && (
        <aside className="planner-panel planner-report glass">
          <div className="report-head">
            <h2>{shownMode === "demo" ? "Catalog demo" : "Design proposal"}</h2>
            <span className={`mode-badge ${shownMode}`}>
              {shownMode === "demo" ? "Scripted demo" : "Live AI"}
            </span>
          </div>
          <p className="report-rationale">{result.candidate.plan.rationale}</p>
          <div className="report-stats">
            <div>
              <strong>{changes.length}</strong>
              <span>changes</span>
            </div>
            <div>
              <strong>{money(newCost)}</strong>
              <span>
                new pieces{unknownPrices ? ` · ${unknownPrices} unpriced` : ""}
              </span>
            </div>
            <div>
              <strong>{result.history.at(-1)?.score ?? "–"}/15</strong>
              <span>style review</span>
            </div>
          </div>

          <ul className="change-list">
            {items.map((i) => {
              const dropped = i.placement === "dropped";
              return (
                <li key={i.key}>
                  <span className={`chip ${dropped ? "dropped" : i.action}`}>
                    {dropped ? "Left out" : actionLabel[i.action]}
                  </span>
                  <div className="change-main">
                    <strong>{i.name}</strong>
                    <small>
                      {i.matchQuality === "closest_available"
                        ? "Closest available model — check style"
                        : i.method === "placeholder"
                          ? "Labelled placeholder — appearance unverified"
                          : methodLabel[i.method]}
                      {i.objectId && modelStatus[i.objectId] === "failed" && (
                        <b className="planner-error-text">
                          {" "}
                          · 3D file failed to load
                        </b>
                      )}
                      {i.objectId && modelStatus[i.objectId] === "loading" && (
                        <span> · Loading 3D file…</span>
                      )}
                    </small>
                    {i.notes.map((note, n) => (
                      <small key={n} className="note">
                        {note}
                      </small>
                    ))}
                  </div>
                  <span className="price">
                    {i.price.estimatedUnitCost
                      ? money(i.price.estimatedUnitCost.minor)
                      : i.action === "keep" || i.action === "move"
                        ? ""
                        : "Price unknown"}
                  </span>
                </li>
              );
            })}
          </ul>
          {result.candidate.warnings.map((w) => (
            <p key={w} className="report-warning">
              {w}
            </p>
          ))}

          <details className="report-reviews">
            <summary>
              How it was refined · {result.history.length}{" "}
              {result.history.length === 1 ? "review" : "reviews"} ·{" "}
              {result.repairs} {result.repairs === 1 ? "repair" : "repairs"}
            </summary>
            {result.history.map((r, i) => (
              <p key={r.candidateId}>
                <strong>
                  Review {i + 1}: {r.score}/15
                </strong>{" "}
                · {r.findings.join("; ") || "No further repairs requested."}
              </p>
            ))}
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
        </aside>
      )}
    </main>
  );
}
