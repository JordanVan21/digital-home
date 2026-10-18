import process from "node:process";
import { existsSync } from "node:fs";
import { createPlannerServer } from "./server";

// Existing environment wins. Reuse the scanner's file by path without copying or modifying it.
const envFile = process.env.PLANNER_ENV_FILE;
if (envFile) process.loadEnvFile(envFile);
else if (existsSync(".env")) process.loadEnvFile(".env");
const port = Number(process.env.PLANNER_PORT ?? 8791);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid PLANNER_PORT.");
const config = {
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseUrl: process.env.PLANNER_BASE_URL ?? "https://api.deepseek.com",
  textModel:
    process.env.PLANNER_TEXT_MODEL ??
    process.env.DEEPSEEK_MODEL ??
    "deepseek-v4-pro",
  visionModel: process.env.PLANNER_VISION_MODEL ?? "deepseek-flash",
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
};
createPlannerServer(config).listen(port, "127.0.0.1", () => {
  console.log(
    `Planner server: http://127.0.0.1:${port} (AI ${config.apiKey ? "configured" : "not configured"})`,
  );
});
