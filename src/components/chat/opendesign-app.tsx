"use client";

/**
 * opendesign app shell — session management, SSE event folding into live
 * assistant messages, and the main layout (sidebar / messages / composer).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Menu, Sparkles, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import {
  deleteSession,
  fetchMcp,
  fetchProviders,
  fetchSession,
  fetchSessions,
  reloadMcp,
  renameSession,
  streamChat,
} from "@/lib/client/api";
import type {
  AgentMode,
  ChatMessage,
  McpServerStatus,
  MessagePart,
  ModelRef,
  ProviderInfo,
  SessionSummary,
  SseEvent,
} from "@/lib/types";
import { Sidebar } from "./sidebar";
import { MessageList } from "./message-list";
import { Composer } from "./composer";
import { ModelPicker } from "./model-picker";
import { SettingsDialog } from "./settings-dialog";
import { MemoryDialog } from "./memory-dialog";
import { McpDialog } from "./mcp-dialog";

function foldEvent(message: ChatMessage, event: SseEvent): ChatMessage {
  const parts: MessagePart[] = message.parts.map((p) => ({ ...p }));
  const last = parts[parts.length - 1];

  const findTool = (id: string) =>
    parts.find((p): p is Extract<MessagePart, { type: "tool" }> => p.type === "tool" && p.id === id);

  switch (event.type) {
    case "reasoning-delta":
      if (last?.type === "reasoning") last.text += event.text;
      else parts.push({ type: "reasoning", text: event.text });
      break;
    case "text-delta":
      if (last?.type === "text") last.text += event.text;
      else parts.push({ type: "text", text: event.text });
      break;
    case "tool-input-start":
      parts.push({ type: "tool", id: event.id, tool: event.tool, state: { status: "streaming", input: "" } });
      break;
    case "tool-input-delta": {
      const t = findTool(event.id);
      if (t && t.state.status === "streaming") t.state = { status: "streaming", input: t.state.input + event.text };
      break;
    }
    case "tool-input-end": {
      const t = findTool(event.id);
      if (t && t.state.status === "streaming") t.state = { status: "running", input: t.state.input };
      break;
    }
    case "tool-call": {
      const t = findTool(event.id);
      let inputStr: string;
      try {
        inputStr = typeof event.input === "string" ? event.input : JSON.stringify(event.input, null, 2);
      } catch {
        inputStr = String(event.input);
      }
      if (t) t.state = { status: "running", input: inputStr };
      else parts.push({ type: "tool", id: event.id, tool: event.tool, state: { status: "running", input: inputStr } });
      break;
    }
    case "tool-result": {
      const t = findTool(event.id);
      if (t) t.state = { status: "completed", input: t.state.input, output: event.output };
      break;
    }
    case "tool-error": {
      const t = findTool(event.id);
      if (t) t.state = { status: "error", input: t.state.input, error: event.error };
      break;
    }
    default:
      break;
  }
  return { ...message, parts };
}

export function OpendesignApp() {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [live, setLive] = useState<ChatMessage | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [mode, setMode] = useState<AgentMode>("build");
  const [modelRef, setModelRef] = useState<ModelRef | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await fetchSessions());
    } catch (e) {
      toast({ title: "Failed to load sessions", description: String(e), variant: "destructive" });
    }
  }, [toast]);

  const refreshProviders = useCallback(async () => {
    try {
      const { providers: p } = await fetchProviders();
      setProviders(p);
    } catch (e) {
      toast({ title: "Failed to load providers", description: String(e), variant: "destructive" });
    } finally {
      setProvidersLoading(false);
    }
  }, [toast]);

  const refreshMcp = useCallback(async () => {
    try {
      setMcpStatuses(await fetchMcp());
    } catch {
      /* shown in dialog */
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
    void refreshProviders();
    void refreshMcp();
  }, [refreshSessions, refreshProviders, refreshMcp]);

  const openSession = useCallback(async (id: string) => {
    setActiveId(id);
    setSidebarOpen(false);
    try {
      const session = await fetchSession(id);
      if (session) {
        setMessages(session.messages);
        return;
      }
    } catch (e) {
      toast({ title: "Failed to open session", description: String(e), variant: "destructive" });
    }
    setMessages([]);
  }, [toast]);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setActiveId(null);
    setMessages([]);
    setLive(null);
    setSidebarOpen(false);
  }, []);

  const removeSession = useCallback(
    async (id: string) => {
      await deleteSession(id).catch(() => null);
      if (activeId === id) newChat();
      await refreshSessions();
    },
    [activeId, newChat, refreshSessions],
  );

  const rename = useCallback(
    async (id: string) => {
      const current = sessions.find((s) => s.id === id)?.title ?? "";
      const title = window.prompt("Rename session", current);
      if (!title?.trim()) return;
      await renameSession(id, title.trim()).catch((e) =>
        toast({ title: "Rename failed", description: String(e), variant: "destructive" }),
      );
      await refreshSessions();
    },
    [sessions, refreshSessions, toast],
  );

  const send = useCallback(
    async (text: string) => {
      if (streaming) return;
      setStreaming(true);
      const userMessage: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        createdAt: new Date().toISOString(),
        mode,
        parts: [{ type: "text", text }],
      };
      setMessages((m) => [...m, userMessage]);

      const controller = new AbortController();
      abortRef.current = controller;
      let liveMsg: ChatMessage | null = null;
      let sessionId = activeId;

      try {
        await streamChat(
          { sessionId: activeId ?? undefined, message: text, mode, model: modelRef },
          (event) => {
            switch (event.type) {
              case "session-info":
                sessionId = event.sessionId;
                setActiveId(event.sessionId);
                break;
              case "user-message":
                // Replace the optimistic message with the persisted one.
                setMessages((m) => m.map((x) => (x.id === userMessage.id ? event.message : x)));
                break;
              case "assistant-start":
                liveMsg = {
                  id: event.id,
                  role: "assistant",
                  createdAt: new Date().toISOString(),
                  model: event.model,
                  mode: event.mode,
                  parts: [],
                };
                setLive(liveMsg);
                break;
              case "step-start":
              case "step-finish":
                break;
              case "error":
                if (liveMsg) {
                  setLive({ ...liveMsg, error: event.message });
                } else {
                  toast({ title: "Agent error", description: event.message, variant: "destructive" });
                }
                break;
              case "assistant-end":
                setLive(null);
                setMessages((m) => [...m, event.message]);
                liveMsg = null;
                break;
              case "done":
                break;
              default:
                if (liveMsg) {
                  liveMsg = foldEvent(liveMsg, event);
                  setLive({ ...liveMsg });
                }
                break;
            }
          },
          controller.signal,
        );
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          toast({ title: "Request failed", description: String(e), variant: "destructive" });
        }
        if (liveMsg) {
          setMessages((m) => [...m, { ...liveMsg!, error: liveMsg!.error ?? "aborted" }]);
        }
      } finally {
        setLive(null);
        setStreaming(false);
        abortRef.current = null;
        void refreshSessions();
        void refreshMcp();
      }
    },
    [activeId, mode, modelRef, streaming, refreshSessions, refreshMcp, toast],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const mcpConnected = useMemo(
    () => mcpStatuses.some((s) => s.state === "connected"),
    [mcpStatuses],
  );
  const mcpToolCount = useMemo(
    () => mcpStatuses.reduce((n, s) => n + (s.state === "connected" ? s.tools.length : 0), 0),
    [mcpStatuses],
  );

  const activeTitle = sessions.find((s) => s.id === activeId)?.title ?? "New chat";

  const sidebar = (
    <Sidebar
      sessions={sessions}
      activeId={activeId}
      onSelect={openSession}
      onNew={newChat}
      onDelete={removeSession}
      onRename={rename}
      onOpenSettings={() => setSettingsOpen(true)}
      onOpenMemory={() => setMemoryOpen(true)}
      onOpenMcp={async () => {
        setMcpOpen(true);
        setMcpStatuses(await reloadMcp());
      }}
      mcpConnected={mcpConnected}
      mcpToolCount={mcpToolCount}
    />
  );

  return (
    <div className="flex h-dvh w-full bg-zinc-950 text-zinc-100">
      {/* Desktop sidebar */}
      <div className="hidden w-64 shrink-0 md:block">{sidebar}</div>

      {/* Mobile sidebar */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-72 border-zinc-800 bg-zinc-950 p-0">
          <SheetTitle className="sr-only">Sessions</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-13 shrink-0 items-center gap-2 border-b border-zinc-800/80 px-3 py-2.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
            className="h-8 w-8 rounded-md text-zinc-400 hover:bg-zinc-800 md:hidden"
            title="Menu"
          >
            <Menu className="h-4 w-4" />
          </Button>
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-emerald-500" />
            <span className="truncate text-sm font-medium text-zinc-200">{activeTitle}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {streaming ? (
              <span className="flex items-center gap-1.5 text-[11px] text-emerald-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                agent running…
              </span>
            ) : null}
            <ModelPicker
              providers={providers}
              value={modelRef}
              onChange={setModelRef}
              loading={providersLoading}
            />
          </div>
        </header>

        <MessageList messages={messages} live={live} streaming={streaming} />

        <Composer
          mode={mode}
          onModeChange={setMode}
          onSend={send}
          onStop={stop}
          streaming={streaming}
          disabled={providers.length === 0}
        />
      </main>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSaved={() => void refreshProviders()}
      />
      <MemoryDialog open={memoryOpen} onOpenChange={setMemoryOpen} />
      <McpDialog
        open={mcpOpen}
        onOpenChange={async (o) => {
          setMcpOpen(o);
          if (!o) void refreshMcp();
        }}
      />
    </div>
  );
}
