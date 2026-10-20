/**
 * GET /api/settings — settings with API keys NEVER exposed (only `hasApiKey`).
 * PUT /api/settings — merge updates. Field rules:
 *   - apiKey: absent → keep existing; "" → clear; any other string → set.
 *   - defaultModel / mcp / agent: replaced wholesale when present.
 *   - customProviders: replaced wholesale (with apiKey merge rules per entry).
 */
import { readSettings, writeSettings } from "@/lib/config";
import { resolveProviderApiKey } from "@/lib/config";
import type { AppSettings, CustomProvider, ProviderOverride } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PublicProviderOverride extends Omit<ProviderOverride, "apiKey"> {
  hasApiKey: boolean;
  apiKeyFromEnv: boolean;
}

interface PublicCustomProvider extends Omit<CustomProvider, "apiKey"> {
  hasApiKey: boolean;
}

function mergeApiKey(existing: string | undefined, incoming: string | undefined): string | undefined {
  if (incoming === undefined) return existing;
  if (incoming === "") return undefined;
  return incoming;
}

export async function GET() {
  const settings = await readSettings();

  const providers: Record<string, PublicProviderOverride> = {};
  for (const [id, o] of Object.entries(settings.providers)) {
    const { key, fromEnv } = resolveProviderApiKey({
      settingsApiKey: o.apiKey,
      envNames: [],
      providerId: id,
    });
    providers[id] = {
      baseURL: o.baseURL,
      enabled: o.enabled,
      hasApiKey: Boolean(key),
      apiKeyFromEnv: fromEnv,
    };
  }

  const customProviders: Record<string, PublicCustomProvider> = {};
  for (const [id, c] of Object.entries(settings.customProviders)) {
    const { key } = resolveProviderApiKey({
      settingsApiKey: c.apiKey,
      envNames: c.env,
      providerId: id,
    });
    const { apiKey: _omit, ...rest } = c;
    customProviders[id] = { ...rest, hasApiKey: Boolean(key) };
  }

  return Response.json({
    settings: {
      defaultModel: settings.defaultModel,
      providers,
      customProviders,
      mcp: settings.mcp,
      agent: settings.agent,
    },
  });
}

export async function PUT(req: Request) {
  const incoming = (await req.json().catch(() => null)) as Partial<{
    defaultModel: AppSettings["defaultModel"];
    providers: Record<string, ProviderOverride>;
    customProviders: Record<string, CustomProvider>;
    mcp: AppSettings["mcp"];
    agent: AppSettings["agent"];
  }> | null;
  if (!incoming) return Response.json({ error: "Invalid JSON body" }, { status: 400 });

  const current = await readSettings();
  const next: AppSettings = { ...current };

  if (incoming.defaultModel !== undefined) {
    next.defaultModel = incoming.defaultModel;
  }

  if (incoming.providers) {
    const providers: Record<string, ProviderOverride> = { ...current.providers };
    for (const [id, o] of Object.entries(incoming.providers)) {
      const existing = providers[id] ?? {};
      providers[id] = {
        apiKey: mergeApiKey(existing.apiKey, o?.apiKey),
        baseURL: o?.baseURL ?? existing.baseURL,
        enabled: o?.enabled ?? existing.enabled,
      };
      // Clean empty entries.
      if (!providers[id].apiKey && !providers[id].baseURL && providers[id].enabled === undefined) {
        delete providers[id];
      }
    }
    next.providers = providers;
  }

  if (incoming.customProviders) {
    const customs: Record<string, CustomProvider> = {};
    for (const [id, c] of Object.entries(incoming.customProviders)) {
      if (!c?.baseURL) continue; // drop invalid entries
      const existing = current.customProviders[id];
      customs[id] = {
        name: c.name || id,
        baseURL: c.baseURL,
        apiKey: mergeApiKey(existing?.apiKey, c.apiKey),
        env: Array.isArray(c.env) ? c.env.filter((e) => /^[A-Za-z0-9_]+$/.test(e)) : undefined,
        models: c.models && Object.keys(c.models).length > 0 ? c.models : { "custom-model": { name: "Custom model" } },
      };
    }
    next.customProviders = customs;
  }

  if (incoming.mcp) next.mcp = incoming.mcp;
  if (incoming.agent?.maxSteps) next.agent = { maxSteps: Math.max(1, Math.min(Number(incoming.agent.maxSteps) || 40, 100)) };

  await writeSettings(next);
  return Response.json({ ok: true });
}
