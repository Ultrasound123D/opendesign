/**
 * opendesign — shared types (server + client).
 *
 * Architecture modeled after opencode v2 (github.com/sst/opencode):
 * - providers: models.dev catalog + custom providers (settings) + env-var auth fallback
 * - MCP: local (stdio) / remote (HTTP) servers, tools namespaced as `{server}_{tool}`
 * - agent: multi-step tool loop emitting normalized stream events
 *   (text-*, reasoning-*, tool-input-*, tool-call/result/error, step-*, finish)
 * - memory: persisted sessions + a long-term memory store with model-facing tools
 */

// ---------------------------------------------------------------------------
// Models & providers
// ---------------------------------------------------------------------------

export type ProviderSource = "catalog" | "custom" | "builtin";

export interface ModelInfo {
  id: string;
  name: string;
  providerId: string;
  providerName?: string;
  reasoning: boolean;
  toolCall: boolean;
  contextLimit?: number;
  outputLimit?: number;
  description?: string;
  /** USD per 1M input tokens, when known. */
  costInput?: number;
  /** USD per 1M output tokens, when known. */
  costOutput?: number;
}

export interface ProviderInfo {
  id: string;
  name: string;
  source: ProviderSource;
  /** Default API base URL (from catalog or custom config). */
  baseURL?: string;
  /** Effective base URL (override applied). */
  effectiveBaseURL?: string;
  /** models.dev runtime package hint, e.g. "@ai-sdk/openai-compatible". */
  npm?: string;
  /** Environment variable names that may hold the API key (catalog `env`). */
  env: string[];
  models: ModelInfo[];
  /** True when an API key is available (settings override or env). */
  hasKey: boolean;
  /** True when the key is resolved from an environment variable. */
  keyFromEnv: boolean;
  disabled?: boolean;
}

export interface ModelRef {
  providerId: string;
  modelId: string;
}

export interface ProviderOverride {
  apiKey?: string;
  baseURL?: string;
  enabled?: boolean;
}

/** opencode-style custom provider (settings.json → customProviders.<id>). */
export interface CustomProvider {
  name: string;
  /** Required endpoint, e.g. "https://llm.example.com/v1". Supports {env:NAME}. */
  baseURL: string;
  apiKey?: string;
  /** Env var names that may hold the API key (checked in order). */
  env?: string[];
  models: Record<string, { name?: string }>;
}

// ---------------------------------------------------------------------------
// Settings (settings.json inside the data dir)
// ---------------------------------------------------------------------------

export type McpServerConfig =
  | {
      type: "local";
      command: string[];
      cwd?: string;
      environment?: Record<string, string>;
      disabled?: boolean;
      /** Per-call execution timeout (ms). Default 120000. */
      timeoutMs?: number;
    }
  | {
      type: "remote";
      url: string;
      headers?: Record<string, string>;
      disabled?: boolean;
      timeoutMs?: number;
    };

export interface AppSettings {
  defaultModel: ModelRef | null;
  providers: Record<string, ProviderOverride>;
  customProviders: Record<string, CustomProvider>;
  mcp: { servers: Record<string, McpServerConfig> };
  agent: { maxSteps: number };
}

// ---------------------------------------------------------------------------
// Sessions & messages (persisted as JSON, one file per session)
// ---------------------------------------------------------------------------

export type AgentMode = "build" | "plan";

export type ToolState =
  | { status: "streaming"; input: string }
  | { status: "running"; input: string }
  | { status: "completed"; input: string; output: string }
  | { status: "error"; input: string; error: string };

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool"; id: string; tool: string; state: ToolState }
  | { type: "plan"; text: string };

export interface UsageInfo {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  createdAt: string;
  model?: string;
  mode?: AgentMode;
  parts: MessagePart[];
  usage?: UsageInfo;
  error?: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  model?: string;
}

export interface Session extends SessionSummary {
  messages: ChatMessage[];
  /** Latest plan produced in plan mode (re-injected when switching to build). */
  plan?: string;
}

// ---------------------------------------------------------------------------
// SSE wire events (server → client), mirroring opencode's event model
// ---------------------------------------------------------------------------

export type SseEvent =
  | { type: "session-info"; sessionId: string; title: string }
  | { type: "user-message"; message: ChatMessage }
  | { type: "assistant-start"; id: string; model: string; mode: AgentMode }
  | { type: "step-start"; index: number }
  | { type: "reasoning-delta"; id: string; text: string }
  | { type: "text-delta"; id: string; text: string }
  | { type: "tool-input-start"; id: string; tool: string }
  | { type: "tool-input-delta"; id: string; text: string }
  | { type: "tool-input-end"; id: string }
  | { type: "tool-call"; id: string; tool: string; input: unknown }
  | { type: "tool-result"; id: string; tool: string; output: string }
  | { type: "tool-error"; id: string; tool: string; error: string }
  | { type: "step-finish"; index: number; finishReason?: string; usage?: UsageInfo }
  | { type: "assistant-end"; message: ChatMessage }
  | { type: "error"; message: string }
  | { type: "done" };

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

export interface McpToolInfo {
  /** Effective (namespaced) name: `{server}_{tool}`. */
  name: string;
  server: string;
  originalName: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpServerStatus {
  name: string;
  config: McpServerConfig;
  state: "connecting" | "connected" | "error" | "disabled";
  tools: McpToolInfo[];
  error?: string;
  lastConnectedAt?: string;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
}

export interface ChatRequestBody {
  sessionId?: string;
  message: string;
  mode: AgentMode;
  model?: ModelRef | null;
}
