/**
 * Model registry — resolves (providerId, modelId) to a runnable model.
 *
 * Provider package mapping (mirrors opencode's catalog `npm` field):
 *   - "@ai-sdk/anthropic"            → createAnthropic (native Messages API)
 *   - "@ai-sdk/google"               → createGoogleGenerativeAI (native Gemini API)
 *   - "@ai-sdk/openai"               → createOpenAI (native, incl. Responses support)
 *   - anything else (incl. custom providers) → createOpenAICompatible with the
 *     provider's base URL — covers OpenRouter, Groq, DeepSeek, Mistral, xAI,
 *     Z.ai, Ollama, vLLM, LM Studio and any OpenAI-compatible endpoint.
 *
 * The special "zai-sandbox" provider runs through the platform SDK
 * (z-ai-web-dev-sdk) with a dedicated tool loop in agent/engine.ts.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import type { ModelRef } from "./types";
import { readSettings, resolveProviderApiKey, substituteEnv } from "./config";
import { getProviderInfo, ZAI_SANDBOX_ID, isZaiSandboxAvailable } from "./catalog";

export interface ResolvedModel {
  ref: ModelRef;
  kind: "aisdk" | "zai-sandbox";
  model?: LanguageModel;
  label: string;
}

export class ModelResolutionError extends Error {}

export async function resolveModel(ref: ModelRef): Promise<ResolvedModel> {
  const { providerId, modelId } = ref;

  if (providerId === ZAI_SANDBOX_ID) {
    if (!(await isZaiSandboxAvailable())) {
      throw new ModelResolutionError("Sandbox provider unavailable (z-ai-web-dev-sdk not installed)");
    }
    return { ref, kind: "zai-sandbox", label: `zai-sandbox/${modelId}` };
  }

  const provider = await getProviderInfo(providerId);
  if (!provider) {
    throw new ModelResolutionError(`Unknown provider "${providerId}"`);
  }
  if (provider.disabled) {
    throw new ModelResolutionError(`Provider "${providerId}" is disabled in settings`);
  }

  const settings = await readSettings();
  const isCustom = provider.source === "custom";
  const override = settings.providers[providerId] ?? {};
  const custom = isCustom ? settings.customProviders[providerId] : undefined;

  const { key } = resolveProviderApiKey({
    settingsApiKey: isCustom ? custom?.apiKey : override.apiKey,
    envNames: provider.env,
    providerId,
  });

  const baseURLRaw = isCustom ? custom?.baseURL : override.baseURL || provider.baseURL;
  if (!baseURLRaw) {
    throw new ModelResolutionError(`Provider "${providerId}" has no base URL configured`);
  }
  const baseURL = substituteEnv(baseURLRaw);

  const modelExists = provider.models.some((m) => m.id === modelId);
  if (!modelExists && !isCustom) {
    // Custom providers may pass arbitrary model ids; catalog providers should not.
    throw new ModelResolutionError(`Model "${modelId}" not found for provider "${providerId}"`);
  }

  const npm = provider.npm ?? "@ai-sdk/openai-compatible";
  const headers: Record<string, string> = {};

  let model: LanguageModel;
  if (npm.includes("anthropic")) {
    const anthropic = createAnthropic({ apiKey: key, baseURL, headers });
    model = anthropic(modelId);
  } else if (npm === "@ai-sdk/google" || npm.includes("google-generative")) {
    if (!key) throw new ModelResolutionError(`Missing API key for "${providerId}" (set it in Settings → Providers)`);
    const google = createGoogleGenerativeAI({ apiKey: key, baseURL, headers });
    model = google(modelId);
  } else if (npm === "@ai-sdk/openai") {
    if (!key) throw new ModelResolutionError(`Missing API key for "${providerId}" (set it in Settings → Providers)`);
    const openai = createOpenAI({ apiKey: key, baseURL, headers });
    model = openai(modelId);
  } else {
    // OpenAI-compatible fallback — the workhorse for most providers.
    const compatible = createOpenAICompatible({
      name: providerId,
      baseURL,
      apiKey: key,
      headers,
    });
    model = compatible(modelId);
  }

  return { ref, kind: "aisdk", model, label: `${providerId}/${modelId}` };
}
