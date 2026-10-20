"use client";

/**
 * Message list — renders persisted + live messages with auto-scroll.
 */
import { useEffect, useRef } from "react";
import { Sparkles, User } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import { MessagePartView } from "./message-parts";

function UsageChip({ message }: { message: ChatMessage }) {
  const u = message.usage;
  if (!u || (!u.inputTokens && !u.outputTokens)) return null;
  return (
    <span className="mt-1 block font-mono text-[10px] text-zinc-600">
      {u.inputTokens ?? 0} in / {u.outputTokens ?? 0} out tokens
    </span>
  );
}

export function MessageList({
  messages,
  live,
  streaming,
}: {
  messages: ChatMessage[];
  live: ChatMessage | null;
  streaming: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (pinnedRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth", block: "end" });
    }
  }, [messages, live, streaming]);

  const all = live ? [...messages, live] : messages;

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
        {all.length === 0 ? (
          <EmptyState />
        ) : (
          all.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="flex max-w-[85%] items-start gap-2">
                  <div className="rounded-2xl rounded-tr-sm border border-zinc-700/60 bg-zinc-800/70 px-4 py-2.5 text-sm text-zinc-100 whitespace-pre-wrap">
                    {m.parts.map((p, i) =>
                      p.type === "text" ? <span key={i}>{p.text}</span> : null,
                    )}
                  </div>
                  <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800">
                    <User className="h-3.5 w-3.5 text-zinc-400" />
                  </span>
                </div>
              </div>
            ) : (
              <div key={m.id} className="flex items-start gap-2">
                <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-900/60 bg-emerald-950/40">
                  <Sparkles className={`h-3.5 w-3.5 ${streaming && live?.id === m.id ? "animate-pulse text-emerald-400" : "text-emerald-500"}`} />
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2 text-[10px] text-zinc-600">
                    <span className="font-mono">{m.model ?? "assistant"}</span>
                    {m.mode === "plan" ? (
                      <span className="rounded-full bg-amber-950/60 px-1.5 py-0.5 text-[9px] font-medium text-amber-400">
                        PLAN MODE
                      </span>
                    ) : null}
                  </div>
                  {m.parts.map((p, i) => (
                    <MessagePartView
                      key={i}
                      part={p}
                      isLast={i === m.parts.length - 1}
                      streaming={streaming && live?.id === m.id}
                    />
                  ))}
                  {m.error ? (
                    <div className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                      {m.error}
                    </div>
                  ) : null}
                  {!streaming || live?.id !== m.id ? <UsageChip message={m} /> : null}
                </div>
              </div>
            ),
          )
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 pt-24 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-900/60 bg-emerald-950/40">
        <Sparkles className="h-6 w-6 text-emerald-400" />
      </div>
      <h2 className="text-lg font-semibold text-zinc-100">Design with a conversation</h2>
      <p className="max-w-md text-sm text-zinc-500">
        Describe a UI and the agent will build it for real in OpenFigma through MCP tools —
        watch its thinking, planning and tool calls live.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2 text-xs">
        {[
          "A music player mobile screen with dark theme",
          "A pricing page with 3 tiers",
          "A login screen for a fitness app",
        ].map((s) => (
          <span key={s} className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-zinc-400">
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}
