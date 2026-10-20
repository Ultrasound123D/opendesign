/**
 * Client-side API helpers (typed fetchers + SSE reader for /api/chat).
 */
import type {
  AppSettings,
  ChatRequestBody,
  McpServerStatus,
  MemoryEntry,
  ModelRef,
  ProviderInfo,
  Session,
  SessionSummary,
  SseEvent,
} from "@/lib/types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchSessions(): Promise<SessionSummary[]> {
  const { sessions } = await json<{ sessions: SessionSummary[] }>(await fetch("/api/sessions"));
  return sessions;
}

export async function fetchSession(id: string): Promise<Session | null> {
  const res = await fetch(`/api/sessions/${id}`);
  if (res.status === 404) return null;
  const { session } = await json<{ session: Session }>(res);
  return session;
}

export async function deleteSession(id: string): Promise<void> {
  await json<{ ok: boolean }>(await fetch(`/api/sessions/${id}`, { method: "DELETE" }));
}

export async function renameSession(id: string, title: string): Promise<void> {
  await json<{ session: Session }>(
    await fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),
  );
}

export async function fetchProviders(): Promise<{ providers: ProviderInfo[]; stale: boolean }> {
  return json<{ providers: ProviderInfo[]; stale: boolean }>(await fetch("/api/providers"));
}

export interface PublicSettings extends AppSettings {
  providers: Record<string, { baseURL?: string; enabled?: boolean; hasApiKey?: boolean; apiKeyFromEnv?: boolean }>;
  customProviders: Record<string, { name: string; baseURL: string; env?: string[]; models: Record<string, { name?: string }>; hasApiKey?: boolean }>;
}

export async function fetchSettings(): Promise<PublicSettings> {
  const { settings } = await json<{ settings: PublicSettings }>(await fetch("/api/settings"));
  return settings;
}

export async function putSettings(patch: unknown): Promise<void> {
  await json<{ ok: boolean }>(
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  );
}

export async function fetchMcp(): Promise<McpServerStatus[]> {
  const { statuses } = await json<{ statuses: McpServerStatus[] }>(await fetch("/api/mcp"));
  return statuses;
}

export async function reloadMcp(): Promise<McpServerStatus[]> {
  const { statuses } = await json<{ statuses: McpServerStatus[] }>(
    await fetch("/api/mcp", { method: "POST" }),
  );
  return statuses;
}

export async function testProvider(body: {
  providerId?: string;
  custom?: { baseURL: string; apiKey?: string };
}): Promise<{ ok: boolean; models?: string[]; error?: string; status?: number }> {
  return json(await fetch("/api/providers/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function fetchMemories(): Promise<MemoryEntry[]> {
  const { memories } = await json<{ memories: MemoryEntry[] }>(await fetch("/api/memory"));
  return memories;
}

export async function addMemory(input: { title: string; content: string; tags?: string[] }): Promise<MemoryEntry> {
  const { memory } = await json<{ memory: MemoryEntry }>(
    await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
  return memory;
}

export async function removeMemory(id: string): Promise<void> {
  await json<{ ok: boolean }>(await fetch(`/api/memory?id=${encodeURIComponent(id)}`, { method: "DELETE" }));
}

/**
 * POST /api/chat and consume its SSE stream, invoking `onEvent` per event.
 * Resolves when the stream ends ("done" or connection close).
 */
export async function streamChat(
  body: ChatRequestBody,
  onEvent: (event: SseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const idx = buffer.indexOf("\n\n");
      if (idx === -1) break;
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of frame.split("\n")) {
        if (line.startsWith("data: ")) {
          try {
            onEvent(JSON.parse(line.slice(6)) as SseEvent);
          } catch {
            /* skip malformed frame */
          }
        }
      }
    }
  }
}

export type { ModelRef };
