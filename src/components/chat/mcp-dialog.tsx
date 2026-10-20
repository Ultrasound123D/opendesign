"use client";

/**
 * MCP dialog — server status, tool explorer and server editor.
 */
import { useEffect, useState } from "react";
import { Cable, RefreshCw, Trash2, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";
import { fetchMcp, reloadMcp, putSettings } from "@/lib/client/api";
import type { McpServerStatus } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";

interface ServerDraft {
  name: string;
  type: "local" | "remote";
  command: string;
  cwd: string;
  env: string;
  url: string;
  headers: string;
}

const emptyDraft: ServerDraft = { name: "", type: "local", command: "", cwd: "", env: "", url: "", headers: "" };

function parseJsonSafe(text: string): Record<string, string> | null {
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    if (typeof v === "object" && v !== null && !Array.isArray(v)) return v as Record<string, string>;
    return null;
  } catch {
    return null;
  }
}

export function McpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [statuses, setStatuses] = useState<McpServerStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<ServerDraft | null>(null);

  const load = async () => {
    setBusy(true);
    try {
      setStatuses(await fetchMcp());
    } catch (e) {
      toast({ title: "Failed to load MCP status", description: String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  const reload = async () => {
    setBusy(true);
    try {
      setStatuses(await reloadMcp());
      toast({ title: "MCP servers reloaded" });
    } catch (e) {
      toast({ title: "Reload failed", description: String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const removeServer = async (name: string) => {
    const next: Record<string, unknown> = {};
    for (const s of statuses) {
      if (s.name === name) continue;
      next[s.name] = s.config;
    }
    await putSettings({ mcp: { servers: next } });
    await reload();
  };

  const saveDraft = async () => {
    if (!draft?.name.trim()) return;
    const servers: Record<string, unknown> = {};
    for (const s of statuses) servers[s.name] = s.config;
    if (draft.type === "local") {
      const command = draft.command.trim().split(/\s+/).filter(Boolean);
      if (command.length === 0) {
        toast({ title: "Command is required", variant: "destructive" });
        return;
      }
      const environment = parseJsonSafe(draft.env);
      if (environment === null) {
        toast({ title: "Environment must be a JSON object", variant: "destructive" });
        return;
      }
      servers[draft.name.trim()] = {
        type: "local",
        command,
        ...(draft.cwd.trim() ? { cwd: draft.cwd.trim() } : {}),
        ...(Object.keys(environment).length > 0 ? { environment } : {}),
      };
    } else {
      if (!draft.url.trim()) {
        toast({ title: "URL is required", variant: "destructive" });
        return;
      }
      const headers = parseJsonSafe(draft.headers);
      if (headers === null) {
        toast({ title: "Headers must be a JSON object", variant: "destructive" });
        return;
      }
      servers[draft.name.trim()] = {
        type: "remote",
        url: draft.url.trim(),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      };
    }
    await putSettings({ mcp: { servers } });
    setDraft(null);
    await reload();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] gap-0 overflow-hidden border-zinc-800 bg-zinc-950 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-zinc-800 px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base text-zinc-100">
            <Cable className="h-4 w-4 text-emerald-400" />
            MCP servers
            <Button
              variant="outline"
              size="sm"
              onClick={reload}
              disabled={busy}
              className="ml-auto h-7 gap-1.5 border-zinc-800 bg-zinc-900 text-[11px] text-zinc-300 hover:bg-zinc-800"
            >
              <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
              Reload
            </Button>
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">
            Local (stdio) and remote (HTTP) Model Context Protocol servers. Tools are exposed to the
            agent as <code className="font-mono text-emerald-400">{"{server}_{tool}"}</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[62vh] space-y-3 overflow-y-auto px-5 py-4">
          {statuses.map((s) => (
            <div key={s.name} className="rounded-lg border border-zinc-800 bg-zinc-900/40">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    s.state === "connected" ? "bg-emerald-500" : s.state === "connecting" ? "animate-pulse bg-amber-500" : s.state === "disabled" ? "bg-zinc-600" : "bg-red-500"
                  }`}
                />
                <span className="font-mono text-sm text-zinc-200">{s.name}</span>
                <Badge variant="outline" className="h-4 rounded px-1 text-[9px] text-zinc-400">
                  {s.config.type}
                </Badge>
                <span className="text-[11px] text-zinc-500">{s.tools.length} tools</span>
                <button
                  type="button"
                  onClick={() => removeServer(s.name)}
                  className="ml-auto rounded p-1 text-zinc-600 hover:text-red-400"
                  title="Remove server"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {s.config.type === "local" ? (
                <div className="px-3 pb-2 font-mono text-[10px] text-zinc-600">
                  {s.config.command.join(" ")}
                  {s.config.environment ? ` · env: ${Object.keys(s.config.environment).join(",")}` : ""}
                </div>
              ) : (
                <div className="px-3 pb-2 font-mono text-[10px] text-zinc-600">{s.config.url}</div>
              )}
              {s.state === "error" && s.error ? (
                <div className="border-t border-red-900/40 bg-red-950/20 px-3 py-2 font-mono text-[10px] text-red-300">
                  {s.error}
                </div>
              ) : null}
              {s.tools.length > 0 ? (
                <Collapsible>
                  <CollapsibleTrigger className="flex w-full items-center gap-1 border-t border-zinc-800/60 px-3 py-1.5 text-[11px] text-zinc-500 hover:text-zinc-300">
                    <ChevronRight className="h-3 w-3" />
                    Tools
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ul className="max-h-48 space-y-1 overflow-y-auto border-t border-zinc-800/60 px-3 py-2">
                      {s.tools.map((t) => (
                        <li key={t.name} className="font-mono text-[11px] text-zinc-400">
                          <span className="text-zinc-200">{t.originalName}</span>
                          <span className="text-zinc-600"> — {t.description?.slice(0, 90) ?? ""}</span>
                        </li>
                      ))}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              ) : null}
            </div>
          ))}

          {draft ? (
            <div className="space-y-2 rounded-lg border border-emerald-900/50 bg-emerald-950/10 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wider text-emerald-400">
                {draft.name ? "Edit" : "Add"} server
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="name (e.g. openfigma)"
                  className="border-zinc-800 bg-zinc-900/60 text-xs text-zinc-100"
                />
                <select
                  value={draft.type}
                  onChange={(e) => setDraft({ ...draft, type: e.target.value as "local" | "remote" })}
                  className="h-9 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 text-xs text-zinc-100"
                >
                  <option value="local">local (stdio)</option>
                  <option value="remote">remote (HTTP)</option>
                </select>
              </div>
              {draft.type === "local" ? (
                <>
                  <Input
                    value={draft.command}
                    onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                    placeholder="command (e.g. node /path/to/mcp-server/dist/index.js)"
                    className="border-zinc-800 bg-zinc-900/60 font-mono text-xs text-zinc-100"
                  />
                  <Input
                    value={draft.cwd}
                    onChange={(e) => setDraft({ ...draft, cwd: e.target.value })}
                    placeholder="working directory (optional)"
                    className="border-zinc-800 bg-zinc-900/60 font-mono text-xs text-zinc-100"
                  />
                  <Input
                    value={draft.env}
                    onChange={(e) => setDraft({ ...draft, env: e.target.value })}
                    placeholder='environment JSON (e.g. {"EDITOR_API_URL":"http://localhost:3000"})'
                    className="border-zinc-800 bg-zinc-900/60 font-mono text-xs text-zinc-100"
                  />
                </>
              ) : (
                <>
                  <Input
                    value={draft.url}
                    onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                    placeholder="https://mcp.example.com/mcp"
                    className="border-zinc-800 bg-zinc-900/60 font-mono text-xs text-zinc-100"
                  />
                  <Input
                    value={draft.headers}
                    onChange={(e) => setDraft({ ...draft, headers: e.target.value })}
                    placeholder='headers JSON (e.g. {"Authorization":"Bearer …"})'
                    className="border-zinc-800 bg-zinc-900/60 font-mono text-xs text-zinc-100"
                  />
                </>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={saveDraft} className="bg-emerald-600 text-xs text-white hover:bg-emerald-500">
                  Save
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDraft(null)} className="border-zinc-800 bg-zinc-900 text-xs text-zinc-300">
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDraft(emptyDraft)}
              className="w-full gap-1.5 border-dashed border-zinc-800 bg-transparent text-xs text-zinc-400 hover:bg-zinc-900"
            >
              <Plus className="h-3.5 w-3.5" /> Add server
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
