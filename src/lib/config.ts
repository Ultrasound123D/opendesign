/**
 * Server-side settings & data-directory management.
 *
 * Storage layout (opencode-inspired, file based instead of SQLite):
 *   <dataDir>/settings.json        — app settings (providers, custom providers, MCP, agent)
 *   <dataDir>/catalog-cache.json   — models.dev catalog cache
 *   <dataDir>/sessions/<id>.json   — one JSON file per chat session
 *   <dataDir>/memory.json          — long-term memory store
 *
 * dataDir = OPENDESIGN_DATA_DIR || ~/.opendesign
 */
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AppSettings, McpServerConfig } from "./types";

export function dataDir(): string {
  return process.env.OPENDESIGN_DATA_DIR || path.join(os.homedir(), ".opendesign");
}

/** Replace `{env:NAME}` placeholders (opencode config variable substitution). */
export function substituteEnv(value: string): string {
  return value.replace(/\{env:([A-Za-z0-9_]+)\}/g, (_, name) => process.env[name] ?? "");
}

/**
 * Auto-detect a sibling/child OpenFigma checkout and seed a default MCP server
 * entry for it. Returns null when nothing is found.
 */
function detectOpenFigmaMcp(): Record<string, McpServerConfig> | null {
  const candidates = [
    path.join(process.cwd(), "openfigma", "mcp-server", "dist", "index.js"),
    path.join(process.cwd(), "..", "openfigma", "mcp-server", "dist", "index.js"),
  ];
  for (const serverPath of candidates) {
    if (existsSync(serverPath)) {
      const root = path.resolve(path.dirname(serverPath), "..", "..");
      return {
        openfigma: {
          type: "local",
          command: ["node", serverPath],
          environment: {
            // OpenFigma's editor app URL (its API server). Adjust in Settings → MCP.
            EDITOR_API_URL: process.env.OPENFIGMA_API_URL || "http://localhost:3111",
          },
        },
      };
    }
  }
  return null;
}

export function defaultSettings(): AppSettings {
  const servers = detectOpenFigmaMcp() ?? {};
  return {
    defaultModel: null,
    providers: {},
    customProviders: {},
    mcp: { servers },
    agent: { maxSteps: 40 },
  };
}

const SETTINGS_PATH = () => path.join(dataDir(), "settings.json");

export async function ensureDataDir(): Promise<void> {
  await fs.mkdir(path.join(dataDir(), "sessions"), { recursive: true });
}

export async function readSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(SETTINGS_PATH(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const defaults = defaultSettings();
    return {
      defaultModel: parsed.defaultModel ?? defaults.defaultModel,
      providers: parsed.providers ?? {},
      customProviders: parsed.customProviders ?? {},
      mcp: { servers: parsed.mcp?.servers ?? defaults.mcp.servers },
      agent: { maxSteps: parsed.agent?.maxSteps ?? defaults.agent.maxSteps },
    };
  } catch {
    return defaultSettings();
  }
}

export async function writeSettings(settings: AppSettings): Promise<void> {
  await ensureDataDir();
  const tmp = `${SETTINGS_PATH()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(settings, null, 2), "utf-8");
  await fs.rename(tmp, SETTINGS_PATH());
}

export async function updateSettings(
  patch: (s: AppSettings) => AppSettings,
): Promise<AppSettings> {
  const current = await readSettings();
  const next = patch(current);
  await writeSettings(next);
  return next;
}

export function resolveProviderApiKey(args: {
  settingsApiKey?: string;
  envNames?: string[];
  providerId: string;
}): { key?: string; fromEnv: boolean } {
  if (args.settingsApiKey && args.settingsApiKey.trim()) {
    return { key: args.settingsApiKey.trim(), fromEnv: false };
  }
  const names = [...(args.envNames ?? []), `OPENDESIGN_${sanitizedEnvName(args.providerId)}_API_KEY`];
  for (const name of names) {
    const v = process.env[name];
    if (v && v.trim()) return { key: v.trim(), fromEnv: true };
  }
  return { key: undefined, fromEnv: false };
}

export function sanitizedEnvName(providerId: string): string {
  return providerId.replace(/[^A-Za-z0-9]/g, "_").toUpperCase();
}
