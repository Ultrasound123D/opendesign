/**
 * POST /api/providers/test — verify a provider endpoint/key by listing models
 * over its native protocol (OpenAI-compatible / Anthropic / Google).
 * Body: { providerId?: string, custom?: { baseURL: string, apiKey?: string } }
 */
import { getProviderInfo } from "@/lib/catalog";
import { readSettings, resolveProviderApiKey, substituteEnv } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TestResult {
  ok: boolean;
  status?: number;
  models?: string[];
  error?: string;
}

async function testOpenAiCompatible(baseURL: string, apiKey: string | undefined): Promise<TestResult> {
  const url = `${baseURL.replace(/\/+$/, "")}/models`;
  const res = await fetch(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status} ${await safeText(res)}` };
  const json = (await res.json().catch(() => null)) as { data?: Array<{ id?: string }> } | null;
  const models = (json?.data ?? []).map((m) => m.id ?? "").filter(Boolean).slice(0, 50);
  return { ok: true, status: 200, models };
}

async function testAnthropic(baseURL: string, apiKey: string | undefined): Promise<TestResult> {
  const url = `${baseURL.replace(/\/+$/, "")}/models`;
  const res = await fetch(url, {
    headers: {
      "x-api-key": apiKey ?? "",
      "anthropic-version": "2023-06-01",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status} ${await safeText(res)}` };
  const json = (await res.json().catch(() => null)) as { data?: Array<{ id?: string }> } | null;
  const models = (json?.data ?? []).map((m) => m.id ?? "").filter(Boolean).slice(0, 50);
  return { ok: true, status: 200, models };
}

async function testGoogle(baseURL: string, apiKey: string | undefined): Promise<TestResult> {
  const base = baseURL.replace(/\/+$/, "");
  const url = `${base}/models?key=${encodeURIComponent(apiKey ?? "")}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status} ${await safeText(res)}` };
  const json = (await res.json().catch(() => null)) as { models?: Array<{ name?: string }> } | null;
  const models = (json?.models ?? []).map((m) => (m.name ?? "").replace("models/", "")).filter(Boolean).slice(0, 50);
  return { ok: true, status: 200, models };
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "";
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    providerId?: string;
    custom?: { baseURL?: string; apiKey?: string };
  };

  let baseURL: string | undefined;
  let apiKey: string | undefined;
  let protocol: "openai" | "anthropic" | "google" = "openai";

  if (body.custom?.baseURL) {
    baseURL = substituteEnv(body.custom.baseURL);
    apiKey = body.custom.apiKey?.trim() || undefined;
  } else if (body.providerId) {
    const info = await getProviderInfo(body.providerId);
    if (!info) return Response.json({ ok: false, error: "Unknown provider" }, { status: 404 });
    if (info.source === "builtin") {
      return Response.json({ ok: true, models: info.models.map((m) => m.id) });
    }
    const settings = await readSettings();
    const isCustom = info.source === "custom";
    const { key } = resolveProviderApiKey({
      settingsApiKey: isCustom
        ? body.custom?.apiKey ?? settings.customProviders[body.providerId]?.apiKey
        : settings.providers[body.providerId]?.apiKey,
      envNames: info.env,
      providerId: body.providerId,
    });
    apiKey = key;
    baseURL = substituteEnv(info.effectiveBaseURL ?? info.baseURL ?? "");
    const npm = info.npm ?? "";
    if (npm.includes("anthropic")) protocol = "anthropic";
    else if (npm === "@ai-sdk/google" || npm.includes("google-generative")) protocol = "google";
  }

  if (!baseURL) return Response.json({ ok: false, error: "No base URL configured" }, { status: 400 });

  try {
    const result =
      protocol === "anthropic"
        ? await testAnthropic(baseURL, apiKey)
        : protocol === "google"
          ? await testGoogle(baseURL, apiKey)
          : await testOpenAiCompatible(baseURL, apiKey);
    return Response.json(result);
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
