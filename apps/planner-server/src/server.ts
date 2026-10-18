import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  AssetSpecSchema,
  RoomShellSchema,
  SceneSpecSchema,
  catalog,
} from "@house/contracts";
import {
  DesignBriefSchema,
  PlannerSession,
  ViewsSchema,
} from "@house/aesthetic-planner";
import { createPlannerModel } from "./model";
import { renderQueue } from "./renderQueue";
import { demoModel, demoRender } from "./demo";

export type PlannerConfig = {
  apiKey?: string;
  baseUrl: string;
  textModel: string;
  visionModel: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};
const StartSchema = z
  .object({
    scene: SceneSpecSchema,
    shell: RoomShellSchema,
    brief: DesignBriefSchema,
    assets: z.array(AssetSpecSchema).max(1000).default([]),
    mode: z.enum(["live", "demo"]),
    cloudRoom: z.boolean().default(false),
  })
  .strict();
async function body(request: IncomingMessage) {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new Error("Send a JSON request.");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 6 * 1024 * 1024) throw new Error("Request is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const send = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
};

export function createPlannerServer(config: PlannerConfig) {
  const sessions = new Map<
    string,
    { session: PlannerSession; expires: number }
  >();
  const model = createPlannerModel(config);
  return createServer(async (request, response) => {
    // Local development service, through Vite's same-origin proxy; no cross-origin access.
    const origin = request.headers.origin;
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) {
      send(response, 403, { error: "Local requests only." });
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    try {
      if (request.method === "GET" && url.pathname === "/planner-api/health") {
        send(response, 200, {
          aiConfigured: !!config.apiKey,
          textModel: config.textModel,
          visionModel: config.visionModel,
        });
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/planner-api/sessions"
      ) {
        for (const [id, entry] of sessions)
          if (entry.expires < Date.now()) sessions.delete(id);
        if (sessions.size >= 20) {
          send(response, 429, {
            error:
              "Too many experiments open. Restart the planner server to clear them.",
          });
          return;
        }
        const input = StartSchema.parse(await body(request));
        if (
          input.scene.shellId !== input.shell.id ||
          input.scene.roomId !== input.brief.roomId
        )
          throw new Error("Room, shell and brief must match.");
        if (input.scene.objects.length > 40)
          throw new Error("This first experiment supports up to 40 pieces.");
        const jwt = request.headers.authorization?.replace(/^Bearer /, "");
        let render = demoRender;
        if (input.mode === "live") {
          if (!config.apiKey) {
            send(response, 503, {
              error:
                "AI is not set up. Set DEEPSEEK_API_KEY in the server environment.",
            });
            return;
          }
          if (!config.supabaseUrl || !config.supabaseAnonKey || !jwt)
            throw new Error(
              "Sign in to use the connected render worker, or choose Demo fallback.",
            );
          const db = createClient(config.supabaseUrl, config.supabaseAnonKey, {
            auth: { persistSession: false },
            global: { headers: { Authorization: `Bearer ${jwt}` } },
          });
          const auth = await db.auth.getUser(jwt);
          if (auth.error || !auth.data.user) {
            send(response, 401, { error: "Sign in again to request models." });
            return;
          }
          render = renderQueue(
            db,
            input.cloudRoom ? input.scene.roomId : undefined,
          );
        }
        const assets = [...catalog, ...input.assets];
        const session = new PlannerSession(input, {
          model: input.mode === "demo" ? demoModel(input) : model,
          render,
          assets,
          uuid: randomUUID,
        });
        const state = await session.start();
        const id = randomUUID();
        sessions.set(id, { session, expires: Date.now() + 30 * 60_000 });
        send(response, 200, { id, mode: input.mode, ...state });
        return;
      }
      const match = /^\/planner-api\/sessions\/([a-f0-9-]{36})\/observe$/.exec(
        url.pathname,
      );
      if (request.method === "POST" && match) {
        const entry = sessions.get(match[1]);
        if (!entry || entry.expires < Date.now()) {
          send(response, 404, {
            error: "Experiment expired. Start a new design.",
          });
          return;
        }
        const input = z
          .object({ candidateId: z.string().uuid(), views: ViewsSchema })
          .strict()
          .parse(await body(request));
        for (const view of input.views) {
          const bytes = Buffer.from(view.image.split(",")[1], "base64");
          if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
            throw new Error("Capture must contain a JPEG image.");
        }
        send(response, 200, {
          id: match[1],
          ...(await entry.session.observe(input.candidateId, input.views)),
        });
        return;
      }
      send(response, 404, { error: "Not found." });
    } catch (error) {
      send(response, 400, {
        error:
          error instanceof z.ZodError
            ? "The request or AI output did not match the planner format. Try again."
            : error instanceof Error
              ? error.message
              : "Could not finish this experiment.",
      });
    }
  });
}
