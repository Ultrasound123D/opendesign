/**
 * Agent engine — the multi-step tool loop (opencode-style runner).
 *
 * Two execution backends behind one normalized event stream:
 *
 * 1. AI SDK `streamText` (real token streaming, reasoning, tool-input deltas)
 *    for every catalog/custom provider.
 * 2. `zai-sandbox` — the platform SDK (z-ai-web-dev-sdk) with a hand-rolled
 *    tool loop; its wire protocol supports OpenAI-style tool_calls but its
 *    streaming is not usable from this runtime, so each step completes
 *    non-streamed and is emitted as a single delta per part.
 *
 * The engine folds raw provider events into durable message parts
 * (text / reasoning / tool / plan) — the same projection pattern opencode
 * uses for its session events — and persists the assistant message at the end.
 */
import { streamText, stepCountIs } from "ai";
import type { ModelMessage } from "ai";
import crypto from "node:crypto";
import type { AgentMode, ChatMessage, MessagePart, ModelRef, Session, SseEvent, UsageInfo } from "../types";
import { readSettings } from "../config";
import { resolveModel } from "../registry";
import { getMcpManager } from "../mcp/manager";
import { buildTools, type ToolDescriptor } from "./tools";
import { buildSystemPrompt } from "./prompt";
import { saveSession } from "../storage/sessions";

export interface RunArgs {
  session: Session;
  mode: AgentMode;
  modelRef: ModelRef;
  emit: (event: SseEvent) => void;
  abortSignal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Live message folding
// ---------------------------------------------------------------------------

class LiveAssistant {
  readonly id: string;
  parts: MessagePart[] = [];
  usage: UsageInfo = {};

  constructor(
    id: string,
    private readonly mode: AgentMode,
    private readonly modelLabel: string,
  ) {
    this.id = id;
  }

  toMessage(): ChatMessage {
    return {
      id: this.id,
      role: "assistant",
      createdAt: new Date().toISOString(),
      model: this.modelLabel,
      mode: this.mode,
      parts: this.parts,
      usage: this.usage.totalTokens || this.usage.inputTokens || this.usage.outputTokens ? this.usage : undefined,
    };
  }

  appendText(text: string): void {
    const last = this.parts[this.parts.length - 1];
    if (last?.type === "text") last.text += text;
    else this.parts.push({ type: "text", text });
  }

  appendReasoning(text: string): void {
    const last = this.parts[this.parts.length - 1];
    if (last?.type === "reasoning") last.text += text;
    else this.parts.push({ type: "reasoning", text });
  }

  startTool(id: string, tool: string): void {
    this.parts.push({ type: "tool", id, tool, state: { status: "streaming", input: "" } });
  }

  appendToolInput(id: string, delta: string): void {
    const part = this.findTool(id);
    if (part && part.state.status === "streaming") part.state.input += delta;
  }

  toolRunning(id: string): void {
    const part = this.findTool(id);
    if (part && part.state.status === "streaming") part.state = { status: "running", input: part.state.input };
  }

  toolCall(id: string, tool: string, input: unknown): void {
    const part = this.findTool(id);
    const inputStr = (() => {
      try {
        return typeof input === "string" ? input : JSON.stringify(input, null, 2);
      } catch {
        return String(input);
      }
    })();
    if (part) {
      part.state = part.state.status === "streaming" || part.state.status === "running"
        ? { status: "running", input: inputStr }
        : part.state;
    } else {
      this.parts.push({ type: "tool", id, tool, state: { status: "running", input: inputStr } });
    }
  }

  toolResult(id: string, output: string): void {
    const part = this.findTool(id);
    if (part) part.state = { status: "completed", input: part.state.input, output: clamp(output, 8_000) };
  }

  toolError(id: string, error: string): void {
    const part = this.findTool(id);
    if (part) part.state = { status: "error", input: part.state.input, error: clamp(error, 2_000) };
  }

  appendPlan(text: string): void {
    this.parts.push({ type: "plan", text });
  }

  private findTool(id: string) {
    return this.parts.find((p): p is Extract<MessagePart, { type: "tool" }> => p.type === "tool" && p.id === id);
  }
}

function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ---------------------------------------------------------------------------
// History conversion
// ---------------------------------------------------------------------------

function toModelMessages(session: Session, system: string): ModelMessage[] {
  const messages: ModelMessage[] = [{ role: "system", content: system }];
  for (const m of session.messages) {
    if (m.role === "user") {
      messages.push({ role: "user", content: [{ type: "text", text: m.parts.map(textOf).join("\n") }] });
      continue;
    }
    // assistant
    const content: Extract<ModelMessage, { role: "assistant" }>["content"] = [];
    const toolResults: Extract<ModelMessage, { role: "tool" }>["content"] = [];
    for (const p of m.parts) {
      if (p.type === "text" && p.text.trim()) content.push({ type: "text", text: p.text });
      else if (p.type === "tool") {
        let input: unknown = {};
        try {
          input = JSON.parse(p.state.input || "{}");
        } catch {
          input = {};
        }
        content.push({ type: "tool-call", toolCallId: p.id, toolName: p.tool, input });
        const output =
          p.state.status === "completed"
            ? p.state.output
            : p.state.status === "error"
              ? `Error: ${p.state.error}`
              : "(no result)";
        toolResults.push({
          type: "tool-result",
          toolCallId: p.id,
          toolName: p.tool,
          output: { type: "text", value: clamp(output, 60_000) },
        });
      }
      // reasoning parts are kept in storage for the UI but not replayed (token economy)
    }
    if (content.length > 0) messages.push({ role: "assistant", content });
    if (toolResults.length > 0) messages.push({ role: "tool", content: toolResults });
  }
  return messages;
}

function textOf(p: MessagePart): string {
  return p.type === "text" ? p.text : p.type === "plan" ? `[plan]\n${p.text}` : "";
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runAgent(args: RunArgs): Promise<Session> {
  const { session, mode, modelRef, emit, abortSignal } = args;
  const settings = await readSettings();
  const maxSteps = Math.max(1, Math.min(settings.agent.maxSteps || 40, 100));

  const manager = getMcpManager();
  const statuses = await manager.statuses();
  const mcpTools = statuses.flatMap((s) => s.tools);
  const serverNames = statuses.filter((s) => s.state === "connected").map((s) => s.name);

  const { toolset, descriptors } = buildTools({ mcpTools, mode });
  const system = await buildSystemPrompt({ mode, tools: mcpTools, serverNames, plan: session.plan });

  const resolved = await resolveModel(modelRef);
  session.model = resolved.label;

  const live = new LiveAssistant(`a-${crypto.randomUUID()}`, mode, resolved.label);
  emit({ type: "assistant-start", id: live.id, model: resolved.label, mode });

  try {
    if (resolved.kind === "zai-sandbox") {
      await runSandboxLoop({ resolvedModelId: resolved.ref.modelId, system, session, mode, descriptors, maxSteps, live, emit, abortSignal });
    } else {
      await runAiSdkLoop({ model: resolved.model!, system, session, toolset, maxSteps, mode, live, emit, abortSignal });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    emit({ type: "error", message });
  }

  const assistantMessage = live.toMessage();
  if (assistantMessage.parts.length > 0 || assistantMessage.usage) {
    session.messages.push(assistantMessage);
  }
  await saveSession(session);
  emit({ type: "assistant-end", message: assistantMessage });
  emit({ type: "done" });
  return session;
}

// ---------------------------------------------------------------------------
// Backend 1: AI SDK streamText
// ---------------------------------------------------------------------------

async function runAiSdkLoop(args: {
  model: NonNullable<Awaited<ReturnType<typeof resolveModel>>["model"]>;
  system: string;
  session: Session;
  toolset: ReturnType<typeof buildTools>["toolset"];
  maxSteps: number;
  mode: AgentMode;
  live: LiveAssistant;
  emit: (e: SseEvent) => void;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const { model, system, session, toolset, maxSteps, live, emit, abortSignal } = args;
  const messages = toModelMessages(session, system);

  const result = streamText({
    model,
    messages,
    tools: toolset,
    stopWhen: stepCountIs(maxSteps),
    abortSignal,
    maxRetries: 1,
  });

  let step = 0;
  for await (const part of result.fullStream) {
    switch (part.type) {
      case "start-step": {
        emit({ type: "step-start", index: step });
        break;
      }
      case "text-delta": {
        live.appendText(part.text);
        emit({ type: "text-delta", id: part.id, text: part.text });
        break;
      }
      case "reasoning-delta": {
        live.appendReasoning(part.text);
        emit({ type: "reasoning-delta", id: part.id, text: part.text });
        break;
      }
      case "tool-input-start": {
        live.startTool(part.id, part.toolName);
        emit({ type: "tool-input-start", id: part.id, tool: part.toolName });
        break;
      }
      case "tool-input-delta": {
        live.appendToolInput(part.id, part.delta);
        emit({ type: "tool-input-delta", id: part.id, text: part.delta });
        break;
      }
      case "tool-input-end": {
        live.toolRunning(part.id);
        emit({ type: "tool-input-end", id: part.id });
        break;
      }
      case "tool-call": {
        live.toolCall(part.toolCallId, part.toolName, part.input);
        emit({ type: "tool-call", id: part.toolCallId, tool: part.toolName, input: part.input });
        break;
      }
      case "tool-result": {
        const output = typeof part.output === "string" ? part.output : safeStringify(part.output);
        live.toolResult(part.toolCallId, output);
        emit({ type: "tool-result", id: part.toolCallId, tool: part.toolName, output: clamp(output, 8_000) });
        if (part.toolName === "write_plan") capturePlan(session, live, part.output);
        break;
      }
      case "tool-error": {
        const error = part.error instanceof Error ? part.error.message : safeStringify(part.error) || "tool failed";
        live.toolError(part.toolCallId, error);
        emit({ type: "tool-error", id: part.toolCallId, tool: part.toolName, error });
        break;
      }
      case "finish-step": {
        emit({
          type: "step-finish",
          index: step,
          finishReason: part.finishReason,
          usage: {
            inputTokens: part.usage?.inputTokens,
            outputTokens: part.usage?.outputTokens,
            totalTokens: part.usage?.totalTokens,
          },
        });
        live.usage = {
          inputTokens: (live.usage.inputTokens ?? 0) + (part.usage?.inputTokens ?? 0),
          outputTokens: (live.usage.outputTokens ?? 0) + (part.usage?.outputTokens ?? 0),
          totalTokens: (live.usage.totalTokens ?? 0) + (part.usage?.totalTokens ?? 0),
        };
        step += 1;
        break;
      }
      case "error": {
        const message = part.error instanceof Error ? part.error.message : safeStringify(part.error);
        emit({ type: "error", message });
        break;
      }
      default:
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Backend 2: zai-sandbox (platform SDK, OpenAI-style tool loop)
// ---------------------------------------------------------------------------

interface OaiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
interface OaiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OaiToolCall[];
  tool_call_id?: string;
}

async function runSandboxLoop(args: {
  resolvedModelId: string;
  system: string;
  session: Session;
  mode: AgentMode;
  descriptors: ToolDescriptor[];
  maxSteps: number;
  live: LiveAssistant;
  emit: (e: SseEvent) => void;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const { resolvedModelId, system, session, descriptors, maxSteps, live, emit, abortSignal } = args;

  const { loadZaiSandbox } = await import("../zai-sandbox");
  const zai = await loadZaiSandbox();
  if (!zai) throw new Error("Sandbox provider unavailable (z-ai-web-dev-sdk not installed)");

  const messages: OaiMessage[] = [{ role: "system", content: system }];
  for (const m of session.messages) {
    if (m.role === "user") {
      messages.push({ role: "user", content: m.parts.map(textOf).join("\n") });
      continue;
    }
    const toolParts = m.parts.filter((p): p is Extract<MessagePart, { type: "tool" }> => p.type === "tool");
    const text = m.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("\n");
    if (toolParts.length > 0) {
      messages.push({
        role: "assistant",
        content: text || null,
        tool_calls: toolParts.map((p) => ({
          id: p.id,
          type: "function" as const,
          function: { name: p.tool, arguments: p.state.input || "{}" },
        })),
      });
      for (const p of toolParts) {
        messages.push({
          role: "tool",
          tool_call_id: p.id,
          content:
            p.state.status === "completed"
              ? p.state.output
              : p.state.status === "error"
                ? `Error: ${p.state.error}`
                : "(no result)",
        });
      }
    } else if (text) {
      messages.push({ role: "assistant", content: text });
    }
  }

  const oaiTools = descriptors.map((d) => ({
    type: "function" as const,
    function: { name: d.name, description: d.description, parameters: d.inputSchema },
  }));

  for (let step = 0; step < maxSteps; step++) {
    if (abortSignal?.aborted) break;
    emit({ type: "step-start", index: step });

    const res: any = await zai.chat.completions.create({
      model: resolvedModelId,
      messages: messages as unknown as Array<{ role: "system" | "user" | "assistant"; content: string }>,
      tools: oaiTools,
      tool_choice: "auto",
    });

    const choice = res?.choices?.[0];
    const msg = choice?.message;
    if (!msg) throw new Error("Empty response from sandbox provider");

    if (res?.usage) {
      live.usage = {
        inputTokens: (live.usage.inputTokens ?? 0) + (res.usage.prompt_tokens ?? 0),
        outputTokens: (live.usage.outputTokens ?? 0) + (res.usage.completion_tokens ?? 0),
        totalTokens: (live.usage.totalTokens ?? 0) + (res.usage.total_tokens ?? 0),
      };
    }

    if (typeof msg.reasoning_content === "string" && msg.reasoning_content) {
      live.appendReasoning(msg.reasoning_content);
      emit({ type: "reasoning-delta", id: `r-${step}`, text: msg.reasoning_content });
    }
    if (typeof msg.content === "string" && msg.content) {
      live.appendText(msg.content);
      emit({ type: "text-delta", id: `t-${step}`, text: msg.content });
    }

    const toolCalls: OaiToolCall[] = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    if (toolCalls.length === 0) {
      emit({ type: "step-finish", index: step, finishReason: choice?.finish_reason ?? "stop" });
      messages.push({ role: "assistant", content: msg.content ?? "" });
      break;
    }

    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: toolCalls });

    for (const tc of toolCalls) {
      const id = tc.id || `call-${step}-${Math.random().toString(36).slice(2, 8)}`;
      const descriptor = descriptors.find((d) => d.name === tc.function.name);
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.function.arguments || "{}");
      } catch {
        input = {};
      }

      live.startTool(id, tc.function.name);
      emit({ type: "tool-input-start", id, tool: tc.function.name });
      emit({ type: "tool-input-delta", id, text: tc.function.arguments || "{}" });
      live.appendToolInput(id, tc.function.arguments || "{}");
      emit({ type: "tool-input-end", id });
      live.toolCall(id, tc.function.name, input);
      emit({ type: "tool-call", id, tool: tc.function.name, input });

      if (!descriptor) {
        const error = `Unknown tool "${tc.function.name}"`;
        live.toolError(id, error);
        emit({ type: "tool-error", id, tool: tc.function.name, error });
        messages.push({ role: "tool", tool_call_id: id, content: `Error: ${error}` });
        continue;
      }

      try {
        const output = await descriptor.execute(input);
        const outputStr = typeof output === "string" ? output : safeStringify(output);
        live.toolResult(id, outputStr);
        emit({ type: "tool-result", id, tool: tc.function.name, output: clamp(outputStr, 8_000) });
        if (tc.function.name === "write_plan") capturePlan(session, live, output);
        messages.push({ role: "tool", tool_call_id: id, content: outputStr });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        live.toolError(id, error);
        emit({ type: "tool-error", id, tool: tc.function.name, error });
        messages.push({ role: "tool", tool_call_id: id, content: `Error: ${error}` });
      }
    }

    emit({ type: "step-finish", index: step, finishReason: "tool-calls" });
  }
}

function capturePlan(session: Session, live: LiveAssistant, output: unknown): void {
  const plan =
    typeof output === "object" && output !== null && "plan" in output
      ? String((output as { plan: unknown }).plan)
      : typeof output === "string"
        ? output
        : "";
  if (plan) {
    session.plan = plan;
    live.appendPlan(plan);
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2) ?? "";
  } catch {
    return String(v);
  }
}
