/**
 * MCP client manager — connects to configured MCP servers (local stdio / remote
 * HTTP), discovers tools, namespaces them as `{server}_{tool}` (opencode
 * convention) and executes calls with a per-server timeout.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerConfig, McpServerStatus, McpToolInfo } from "../types";
import { readSettings } from "../config";

const DEFAULT_TIMEOUT_MS = 120_000;

function namespace(server: string): string {
  return server.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function effectiveToolName(server: string, tool: string): string {
  return `${namespace(server)}_${tool.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

interface ServerEntry {
  name: string;
  config: McpServerConfig;
  client: Client | null;
  state: McpServerStatus["state"];
  tools: McpToolInfo[];
  error?: string;
  lastConnectedAt?: string;
  connecting?: Promise<void>;
}

class McpManager {
  private servers = new Map<string, ServerEntry>();

  async reload(): Promise<void> {
    const settings = await readSettings();
    const configured = settings.mcp.servers ?? {};

    // Drop entries removed from config.
    for (const name of [...this.servers.keys()]) {
      if (!(name in configured)) {
        await this.closeEntry(this.servers.get(name)!);
        this.servers.delete(name);
      }
    }

    // (Re)create entries whose config changed.
    for (const [name, config] of Object.entries(configured)) {
      const existing = this.servers.get(name);
      if (existing && JSON.stringify(existing.config) === JSON.stringify(config)) continue;
      if (existing) await this.closeEntry(existing);
      this.servers.set(name, { name, config, client: null, state: "connecting", tools: [] });
    }

    await this.connectAll();
  }

  private async closeEntry(entry: ServerEntry): Promise<void> {
    try {
      await entry.client?.close();
    } catch {
      /* ignore */
    }
    entry.client = null;
  }

  private async connectAll(): Promise<void> {
    await Promise.all(
      [...this.servers.values()]
        .filter((e) => e.state !== "disabled" && !e.client)
        .map((e) => this.connectEntry(e)),
    );
  }

  private async connectEntry(entry: ServerEntry): Promise<void> {
    if (entry.config.disabled) {
      entry.state = "disabled";
      return;
    }
    if (entry.connecting) return entry.connecting;

    entry.connecting = (async () => {
      entry.state = "connecting";
      entry.error = undefined;
      try {
        const client = new Client({ name: "opendesign", version: "1.0.0" });
        if (entry.config.type === "local") {
          const [command, ...args] = entry.config.command;
          const transport = new StdioClientTransport({
            command,
            args,
            cwd: entry.config.cwd,
            env: {
              ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
              ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
              ...(entry.config.environment ?? {}),
            },
          });
          await client.connect(transport);
        } else {
          const transport = new StreamableHTTPClientTransport(new URL(entry.config.url), {
            requestInit: { headers: entry.config.headers },
          });
          await client.connect(transport);
        }
        entry.client = client;
        const res = await client.listTools();
        entry.tools = (res.tools ?? []).map((t) => ({
          name: effectiveToolName(entry.name, t.name ?? ""),
          server: entry.name,
          originalName: t.name ?? "",
          description: t.description,
          inputSchema: t.inputSchema as unknown,
        }));
        entry.state = "connected";
        entry.lastConnectedAt = new Date().toISOString();
      } catch (e) {
        entry.state = "error";
        entry.error = e instanceof Error ? e.message : String(e);
        entry.tools = [];
        await this.closeEntry(entry);
      } finally {
        entry.connecting = undefined;
      }
    })();
    return entry.connecting;
  }

  /** Ensure all enabled servers are connected (lazy first call, reconnect on error). */
  async ensureConnected(): Promise<void> {
    if (this.servers.size === 0) await this.reload();
    const broken = [...this.servers.values()].filter(
      (e) => e.state !== "disabled" && !e.client && !e.connecting,
    );
    if (broken.length > 0) await this.connectAll();
  }

  async statuses(): Promise<McpServerStatus[]> {
    await this.ensureConnected();
    return [...this.servers.values()].map((e) => ({
      name: e.name,
      config: e.config,
      state: e.state,
      tools: e.tools,
      error: e.error,
      lastConnectedAt: e.lastConnectedAt,
    }));
  }

  async allTools(): Promise<McpToolInfo[]> {
    await this.ensureConnected();
    return [...this.servers.values()].flatMap((e) => e.tools);
  }

  async callTool(namespacedName: string, args: Record<string, unknown>): Promise<string> {
    await this.ensureConnected();
    for (const entry of this.servers.values()) {
      const tool = entry.tools.find((t) => t.name === namespacedName);
      if (!tool) continue;
      if (!entry.client) {
        await this.connectEntry(entry);
        if (!entry.client) {
          throw new Error(`MCP server "${entry.name}" is not connected (${entry.error ?? entry.state})`);
        }
      }
      const timeoutMs = entry.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const result = await Promise.race([
        entry.client.callTool({ name: tool.originalName, arguments: args }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`MCP tool "${namespacedName}" timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
      const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
      const text = content
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text)
        .join("\n");
      const isError = Boolean((result as { isError?: boolean }).isError);
      const payload = text || JSON.stringify(result);
      if (isError) throw new Error(payload);
      return payload;
    }
    throw new Error(`Unknown MCP tool "${namespacedName}"`);
  }
}

// HMR-safe singleton (mirrors openfigma's src/lib/events/bus.ts pattern).
export function getMcpManager(): McpManager {
  const g = globalThis as typeof globalThis & { __opendesign_mcp?: McpManager };
  if (!g.__opendesign_mcp) g.__opendesign_mcp = new McpManager();
  return g.__opendesign_mcp;
}
