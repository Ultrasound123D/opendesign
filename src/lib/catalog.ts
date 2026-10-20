/**
 * Provider/model catalog — models.dev integration (same source opencode uses).
 *
 * Resolution order (opencode-style):
 *   1. in-memory cache (24h TTL)
 *   2. disk cache  <dataDir>/catalog-cache.json (any age when offline)
 *   3. https://models.dev/api.json → mirror https://models.opencode.ai/api.json
 *   4. minimal built-in fallback list (offline, first run)
 * Then merged with:
 *   - user custom providers (settings.customProviders, opencode-style)
 *   - built-in "zai-sandbox" provider when z-ai-web-dev-sdk is installed
 *     (sandbox convenience so the app works out of the box with no keys)
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { CustomProvider, ModelInfo, ProviderInfo } from "./types";
import { dataDir, readSettings, resolveProviderApiKey } from "./config";

const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

interface ModelsDevModel {
  id: string;
  name?: string;
  description?: string;
  reasoning?: boolean;
  tool_call?: boolean;
  limit?: { context?: number; output?: number };
  cost?: { input?: number; output?: number };
}

interface ModelsDevProvider {
  id: string;
  name?: string;
  api?: string;
  npm?: string;
  env?: string[];
  models?: Record<string, ModelsDevModel>;
}

interface CatalogCache {
  fetchedAt: string;
  providers: Record<string, ModelsDevProvider>;
}

let memoryCache: CatalogCache | null = null;
let inflight: Promise<CatalogCache | null> | null = null;

/** Minimal offline fallback (clearly real, widely available models). */
const FALLBACK: CatalogCache = {
  fetchedAt: "1970-01-01T00:00:00.000Z",
  providers: {
    openai: { id: "openai", name: "OpenAI", api: "https://api.openai.com/v1", npm: "@ai-sdk/openai", env: ["OPENAI_API_KEY"], models: {} },
    anthropic: { id: "anthropic", name: "Anthropic", api: "https://api.anthropic.com/v1", npm: "@ai-sdk/anthropic", env: ["ANTHROPIC_API_KEY"], models: {} },
    google: { id: "google", name: "Google AI Studio", api: "https://generativelanguage.googleapis.com/v1beta", npm: "@ai-sdk/google", env: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"], models: {} },
    openrouter: { id: "openrouter", name: "OpenRouter", api: "https://openrouter.ai/api/v1", npm: "@ai-sdk/openai-compatible", env: ["OPENROUTER_API_KEY"], models: {} },
    groq: { id: "groq", name: "Groq", api: "https://api.groq.com/openai/v1", npm: "@ai-sdk/openai-compatible", env: ["GROQ_API_KEY"], models: {} },
    deepseek: { id: "deepseek", name: "DeepSeek", api: "https://api.deepseek.com/v1", npm: "@ai-sdk/openai-compatible", env: ["DEEPSEEK_API_KEY"], models: {} },
    mistral: { id: "mistral", name: "Mistral AI", api: "https://api.mistral.ai/v1", npm: "@ai-sdk/openai-compatible", env: ["MISTRAL_API_KEY"], models: {} },
    xai: { id: "xai", name: "xAI", api: "https://api.x.ai/v1", npm: "@ai-sdk/openai-compatible", env: ["XAI_API_KEY"], models: {} },
    zai: { id: "zai", name: "Z.ai (GLM)", api: "https://api.z.ai/api/paas/v4", npm: "@ai-sdk/openai-compatible", env: ["ZAI_API_KEY", "ZHIPU_API_KEY"], models: {} },
  },
};

function cachePath(): string {
  return path.join(dataDir(), "catalog-cache.json");
}

async function readDiskCache(): Promise<CatalogCache | null> {
  try {
    const raw = await fs.readFile(cachePath(), "utf-8");
    const parsed = JSON.parse(raw) as CatalogCache;
    if (parsed && parsed.providers && typeof parsed.providers === "object") return parsed;
  } catch {
    /* no cache */
  }
  return null;
}

async function writeDiskCache(cache: CatalogCache): Promise<void> {
  try {
    await fs.mkdir(dataDir(), { recursive: true });
    await fs.writeFile(cachePath(), JSON.stringify(cache), "utf-8");
  } catch {
    /* best-effort */
  }
}

async function fetchRemote(): Promise<CatalogCache | null> {
  const urls = ["https://models.dev/api.json", "https://models.opencode.ai/api.json"];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue;
      const providers = (await res.json()) as Record<string, ModelsDevProvider>;
      if (providers && Object.keys(providers).length > 0) {
        return { fetchedAt: new Date().toISOString(), providers };
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

async function loadCatalog(): Promise<{ cache: CatalogCache; stale: boolean }> {
  if (memoryCache && Date.now() - Date.parse(memoryCache.fetchedAt) < CATALOG_TTL_MS) {
    return { cache: memoryCache, stale: false };
  }
  if (!inflight) {
    inflight = (async () => {
      const disk = await readDiskCache();
      if (disk && Date.now() - Date.parse(disk.fetchedAt) < CATALOG_TTL_MS) return disk;
      const remote = await fetchRemote();
      if (remote) {
        await writeDiskCache(remote);
        return remote;
      }
      return disk;
    })()
      .then((c) => {
        memoryCache = c;
        return c;
      })
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
  }
  const fresh = await inflight;
  if (fresh) return { cache: fresh, stale: false };
  const disk = await readDiskCache();
  if (disk) return { cache: disk, stale: true };
  return { cache: FALLBACK, stale: true };
}

function toProviderInfo(p: ModelsDevProvider): ProviderInfo {
  const models: ModelInfo[] = Object.values(p.models ?? {})
    .filter((m) => m && m.id)
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      providerId: p.id,
      providerName: p.name,
      reasoning: Boolean(m.reasoning),
      toolCall: m.tool_call !== false,
      contextLimit: m.limit?.context,
      outputLimit: m.limit?.output,
      description: m.description?.slice(0, 180),
      costInput: m.cost?.input,
      costOutput: m.cost?.output,
    }));
  return {
    id: p.id,
    name: p.name ?? p.id,
    source: "catalog",
    baseURL: p.api,
    npm: p.npm,
    env: p.env ?? [],
    models,
    hasKey: false,
    keyFromEnv: false,
  };
}

function customToProviderInfo(id: string, c: CustomProvider): ProviderInfo {
  const models: ModelInfo[] = Object.entries(c.models ?? {}).map(([modelId, m]) => ({
    id: modelId,
    name: m?.name ?? modelId,
    providerId: id,
    providerName: c.name,
    reasoning: false,
    toolCall: true,
  }));
  return {
    id,
    name: c.name || id,
    source: "custom",
    baseURL: c.baseURL,
    npm: "@ai-sdk/openai-compatible",
    env: c.env ?? [],
    models,
    hasKey: false,
    keyFromEnv: false,
  };
}

let zaiSandboxAvailable: boolean | null = null;

/** True when the platform SDK (z-ai-web-dev-sdk) is importable → built-in sandbox provider. */
export async function isZaiSandboxAvailable(): Promise<boolean> {
  if (zaiSandboxAvailable !== null) return zaiSandboxAvailable;
  const { loadZaiSandbox } = await import("./zai-sandbox");
  const client = await loadZaiSandbox();
  zaiSandboxAvailable = client !== null;
  return zaiSandboxAvailable;
}

export const ZAI_SANDBOX_ID = "zai-sandbox";
export const ZAI_SANDBOX_MODELS = ["glm-4.6", "glm-4.5"];

function zaiSandboxProvider(): ProviderInfo {
  return {
    id: ZAI_SANDBOX_ID,
    name: "Z.ai Sandbox (built-in, no key)",
    source: "builtin",
    baseURL: "platform-sdk",
    npm: "z-ai-web-dev-sdk",
    env: [],
    hasKey: true,
    keyFromEnv: false,
    models: ZAI_SANDBOX_MODELS.map((id) => ({
      id,
      name: `GLM ${id.replace("glm-", "")}`,
      providerId: ZAI_SANDBOX_ID,
      providerName: "Z.ai Sandbox",
      reasoning: false,
      toolCall: true,
      contextLimit: 128000,
    })),
  };
}

/**
 * Full provider listing: catalog + custom + built-ins, with key/override state applied.
 */
export async function listProviders(): Promise<{ providers: ProviderInfo[]; stale: boolean }> {
  const settings = await readSettings();
  const { cache, stale } = await loadCatalog();

  const providers: ProviderInfo[] = Object.values(cache.providers)
    .filter((p) => p && p.id)
    .map(toProviderInfo);

  // Apply overrides + key resolution for catalog providers.
  for (const p of providers) {
    const override = settings.providers[p.id] ?? {};
    const { key, fromEnv } = resolveProviderApiKey({
      settingsApiKey: override.apiKey,
      envNames: p.env,
      providerId: p.id,
    });
    p.hasKey = Boolean(key);
    p.keyFromEnv = fromEnv;
    p.effectiveBaseURL = override.baseURL || p.baseURL;
    p.disabled = override.enabled === false;
  }

  // Custom providers (opencode-style).
  for (const [id, c] of Object.entries(settings.customProviders ?? {})) {
    const info = customToProviderInfo(id, c);
    const { key, fromEnv } = resolveProviderApiKey({
      settingsApiKey: c.apiKey,
      envNames: c.env,
      providerId: id,
    });
    info.hasKey = Boolean(key);
    info.keyFromEnv = fromEnv;
    info.effectiveBaseURL = info.baseURL;
    providers.push(info);
  }

  // Built-in sandbox provider.
  if (await isZaiSandboxAvailable()) {
    providers.unshift(zaiSandboxProvider());
  }

  providers.sort((a, b) => {
    const rank = (p: ProviderInfo) => (p.source === "builtin" ? 0 : p.source === "custom" ? 1 : 2);
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });

  return { providers, stale };
}

export async function getProviderInfo(providerId: string): Promise<ProviderInfo | null> {
  const { providers } = await listProviders();
  return providers.find((p) => p.id === providerId) ?? null;
}
