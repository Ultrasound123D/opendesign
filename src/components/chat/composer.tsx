"use client";

/**
 * Composer — message input with Build/Plan mode toggle (opencode-style).
 */
import { useRef, useState } from "react";
import { ArrowUp, Square, Hammer, Map } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AgentMode } from "@/lib/types";

export function Composer({
  mode,
  onModeChange,
  onSend,
  onStop,
  streaming,
  disabled,
}: {
  mode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
  onSend: (message: string) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const text = value.trim();
    if (!text || streaming || disabled) return;
    onSend(text);
    setValue("");
    requestAnimationFrame(() => ref.current?.focus());
  };

  return (
    <div className="border-t border-zinc-800/80 bg-zinc-950/80 px-4 py-3">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => onModeChange("build")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors ${
                mode === "build" ? "bg-emerald-600/20 text-emerald-300" : "text-zinc-500 hover:text-zinc-300"
              }`}
              title="Build mode: the agent can create and modify designs"
            >
              <Hammer className="h-3 w-3" />
              Build
            </button>
            <button
              type="button"
              onClick={() => onModeChange("plan")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors ${
                mode === "plan" ? "bg-amber-600/20 text-amber-300" : "text-zinc-500 hover:text-zinc-300"
              }`}
              title="Plan mode: read-only exploration, then a written plan"
            >
              <Map className="h-3 w-3" />
              Plan
            </button>
          </div>
          <span className="text-[11px] text-zinc-600">
            {mode === "plan" ? "Read-only — the agent writes a plan, then you switch to Build" : "The agent can edit designs via MCP tools"}
          </span>
        </div>
        <div className="flex items-end gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-2 focus-within:border-zinc-600">
          <Textarea
            ref={ref}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={mode === "plan" ? "Describe what to plan…" : "Describe a design to build…"}
            rows={1}
            className="max-h-52 min-h-[40px] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          {streaming ? (
            <Button
              type="button"
              size="icon"
              onClick={onStop}
              className="h-9 w-9 shrink-0 rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
              title="Stop"
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              onClick={submit}
              disabled={!value.trim() || disabled}
              className="h-9 w-9 shrink-0 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600"
              title="Send (Enter)"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
