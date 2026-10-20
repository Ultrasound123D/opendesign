/**
 * POST /api/chat — the agent endpoint (SSE stream of SseEvent).
 * Creates/loads a session, appends the user message and runs the agent loop.
 */
import { runAgent } from "@/lib/agent/engine";
import { readSettings } from "@/lib/config";
import { isZaiSandboxAvailable, ZAI_SANDBOX_ID } from "@/lib/catalog";
import { createSession, deriveTitle, getSession, saveSession } from "@/lib/storage/sessions";
import type { ChatMessage, ChatRequestBody, ModelRef, SseEvent } from "@/lib/types";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  if (!message) return Response.json({ error: "message is required" }, { status: 400 });
  const mode = body.mode === "plan" ? "plan" : "build";

  // Load or create the session.
  let session = body.sessionId ? await getSession(body.sessionId) : null;
  if (!session) session = await createSession(deriveTitle(message));
  if (session.messages.length === 0) session.title = deriveTitle(message);

  // Model resolution: explicit → settings default → sandbox fallback.
  let modelRef: ModelRef | null = body.model ?? null;
  if (!modelRef) {
    const settings = await readSettings();
    modelRef = settings.defaultModel;
  }
  if (!modelRef && (await isZaiSandboxAvailable())) {
    modelRef = { providerId: ZAI_SANDBOX_ID, modelId: "glm-4.6" };
  }
  if (!modelRef) {
    return Response.json(
      { error: "No model configured. Open Settings → Providers to add an API key, or set a default model." },
      { status: 400 },
    );
  }

  // Persist the user message.
  const userMessage: ChatMessage = {
    id: `u-${crypto.randomUUID()}`,
    role: "user",
    createdAt: new Date().toISOString(),
    mode,
    parts: [{ type: "text", text: message }],
  };
  session.messages.push(userMessage);
  await saveSession(session);
  const sessionId = session.id;
  const title = session.title;
  const runSession = session;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: SseEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      emit({ type: "session-info", sessionId, title });
      emit({ type: "user-message", message: userMessage });
      try {
        await runAgent({
          session: runSession,
          mode,
          modelRef,
          emit,
          abortSignal: req.signal,
        });
      } catch (e) {
        emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
        emit({ type: "done" });
      }
      closed = true;
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
