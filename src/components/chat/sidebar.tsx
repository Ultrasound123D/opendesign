"use client";

/**
 * Sidebar — sessions list with actions, plus Memory / MCP / Settings entries.
 */
import { MessageSquare, Plus, Settings, Trash2, Brain, Cable, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SessionSummary } from "@/lib/types";

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function Sidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onOpenSettings,
  onOpenMemory,
  onOpenMcp,
  mcpConnected,
  mcpToolCount,
}: {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string) => void;
  onOpenSettings: () => void;
  onOpenMemory: () => void;
  onOpenMcp: () => void;
  mcpConnected: boolean;
  mcpToolCount: number;
}) {
  return (
    <aside className="flex h-full w-full flex-col border-r border-zinc-800/80 bg-zinc-950">
      <div className="flex items-center justify-between px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-600 text-[11px] font-bold text-white">
            od
          </div>
          <span className="text-sm font-semibold tracking-tight text-zinc-100">opendesign</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onNew}
          className="h-7 w-7 rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          title="New chat"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="mx-3 mb-2 flex items-center gap-1.5 rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-2.5 py-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${mcpConnected ? "bg-emerald-500" : "bg-zinc-600"}`} />
        <button type="button" onClick={onOpenMcp} className="min-w-0 flex-1 text-left text-[11px] text-zinc-400 hover:text-zinc-200">
          MCP · {mcpToolCount} tools
        </button>
        <Cable className="h-3.5 w-3.5 text-zinc-600" />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        <div className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-zinc-600">Sessions</div>
        {sessions.length === 0 ? (
          <div className="px-2 py-3 text-xs text-zinc-700">No sessions yet</div>
        ) : (
          <ul className="space-y-0.5">
            {sessions.map((s) => (
              <li key={s.id}>
                <div
                  className={`group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm ${
                    activeId === s.id ? "bg-zinc-800/80 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  }`}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                  <button type="button" onClick={() => onSelect(s.id)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[13px]">{s.title}</span>
                    <span className="block text-[10px] text-zinc-600">
                      {timeAgo(s.updatedAt)} · {s.messageCount} msg
                    </span>
                  </button>
                  <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                    <button
                      type="button"
                      onClick={() => onRename(s.id)}
                      className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
                      title="Rename"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(s.id)}
                      className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-red-400"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </nav>

      <div className="border-t border-zinc-800/80 p-2">
        <Button
          variant="ghost"
          onClick={onOpenMemory}
          className="w-full justify-start gap-2 rounded-md px-2 py-1.5 text-[13px] font-normal text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
        >
          <Brain className="h-4 w-4 text-zinc-500" />
          Memory
        </Button>
        <Button
          variant="ghost"
          onClick={onOpenMcp}
          className="w-full justify-start gap-2 rounded-md px-2 py-1.5 text-[13px] font-normal text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
        >
          <Cable className="h-4 w-4 text-zinc-500" />
          MCP servers
        </Button>
        <Button
          variant="ghost"
          onClick={onOpenSettings}
          className="w-full justify-start gap-2 rounded-md px-2 py-1.5 text-[13px] font-normal text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
        >
          <Settings className="h-4 w-4 text-zinc-500" />
          Settings
        </Button>
      </div>
    </aside>
  );
}
