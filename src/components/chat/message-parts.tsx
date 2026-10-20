"use client";

/**
 * Message part renderers — the transparency layer:
 * thinking (reasoning) blocks, plan cards and MCP tool-call cards with live
 * status (streaming args → running → completed/error), matching the
 * "what the model is thinking / planning / doing" requirement.
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, Brain, Wrench, Check, X, Loader2, ListChecks } from "lucide-react";
import type { MessagePart, ToolState } from "@/lib/types";
import { Markdown } from "./markdown";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export function ReasoningBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(streaming ?? false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-zinc-800/80 bg-zinc-900/40">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-400 hover:text-zinc-200">
        <Brain className={`h-3.5 w-3.5 ${streaming ? "animate-pulse text-emerald-400" : "text-zinc-500"}`} />
        <span className={streaming ? "text-emerald-400" : ""}>
          {streaming ? "Thinking…" : "Thought process"}
        </span>
        <span className="ml-auto flex items-center gap-1 text-zinc-600">
          {text.length.toLocaleString()} chars
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="max-h-64 overflow-y-auto border-t border-zinc-800/80 px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-zinc-400">
          {text}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function statusIcon(state: ToolState) {
  if (state.status === "streaming" || state.status === "running") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />;
  }
  if (state.status === "completed") return <Check className="h-3.5 w-3.5 text-emerald-500" />;
  return <X className="h-3.5 w-3.5 text-red-500" />;
}

function statusLabel(state: ToolState): string {
  if (state.status === "streaming") return "preparing args";
  if (state.status === "running") return "running";
  if (state.status === "completed") return "completed";
  return "failed";
}

function prettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export function ToolCard({ part }: { part: Extract<MessagePart, { type: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const { tool, state } = part;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-zinc-800 bg-zinc-950/60">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <Wrench className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <code className="truncate font-mono text-xs text-zinc-200">{tool}</code>
        <span
          className={`ml-1 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
            state.status === "error"
              ? "bg-red-950/60 text-red-400"
              : state.status === "completed"
                ? "bg-emerald-950/60 text-emerald-400"
                : "bg-zinc-800 text-zinc-300"
          }`}
        >
          {statusLabel(state)}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {statusIcon(state)}
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-zinc-600" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />
          )}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 border-t border-zinc-800 px-3 py-2">
          {state.input ? (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">Input</div>
              <pre className="max-h-48 overflow-auto rounded-md bg-zinc-900/80 p-2 font-mono text-[11px] leading-relaxed text-zinc-300">
                {prettyJson(state.input)}
              </pre>
            </div>
          ) : null}
          {state.status === "completed" && state.output ? (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">Output</div>
              <pre className="max-h-56 overflow-auto rounded-md bg-zinc-900/80 p-2 font-mono text-[11px] leading-relaxed text-zinc-400">
                {state.output.length > 4000 ? `${state.output.slice(0, 4000)}\n…` : state.output}
              </pre>
            </div>
          ) : null}
          {state.status === "error" ? (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-red-500">Error</div>
              <pre className="overflow-auto rounded-md bg-red-950/30 p-2 font-mono text-[11px] text-red-300">
                {state.error}
              </pre>
            </div>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function PlanCard({ text }: { text: string }) {
  const [open, setOpen] = useState(true);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-emerald-900/60 bg-emerald-950/20">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-emerald-300">
        <ListChecks className="h-4 w-4" />
        Plan
        <span className="ml-auto">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-emerald-900/50 px-3 py-2 text-zinc-300">
          <Markdown>{text}</Markdown>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function MessagePartView({
  part,
  isLast,
  streaming,
}: {
  part: MessagePart;
  isLast: boolean;
  streaming: boolean;
}) {
  switch (part.type) {
    case "text":
      return (
        <div className="text-zinc-100">
          <Markdown>{part.text}</Markdown>
        </div>
      );
    case "reasoning":
      return <ReasoningBlock text={part.text} streaming={streaming && isLast} />;
    case "tool":
      return <ToolCard part={part} />;
    case "plan":
      return <PlanCard text={part.text} />;
    default:
      return null;
  }
}
