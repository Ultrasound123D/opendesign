/**
 * Toolset assembly for the agent loop.
 *
 * - MCP tools are exposed with their server JSON Schema passed straight
 *   through (opencode does the same — no zod conversion).
 * - Built-in tools: memory_* (long-term memory) and write_plan (plan mode).
 * - Plan mode keeps only read-only tools (name-based heuristic) plus the
 *   built-ins; opencode instead denies mutating tools via permissions — we
 *   filter them out entirely so the model doesn't waste tokens attempting them.
 */
import { tool, jsonSchema } from "ai";
import type { ToolSet } from "ai";
import type { AgentMode, McpToolInfo } from "../types";
import { getMcpManager } from "../mcp/manager";
import { deleteMemory, listMemories, saveMemory, searchMemories } from "../storage/memory";

const READ_ONLY_PREFIXES = ["list_", "get_", "search_", "find_", "read_"];

export function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_PREFIXES.some((p) => name.startsWith(p));
}

/** Truncate huge tool outputs so a single design dump can't blow the context. */
function clampOutput(text: string, maxChars = 60_000): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[output truncated at ${maxChars} chars — use search/list tools for specifics]`;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: object;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolsetBundle {
  /** AI SDK toolset (used by streamText engine). */
  toolset: ToolSet;
  /** Flat descriptors (used by the zai-sandbox engine + write_plan capture). */
  descriptors: ToolDescriptor[];
}

export function buildTools(args: { mcpTools: McpToolInfo[]; mode: AgentMode }): ToolsetBundle {
  const descriptors: ToolDescriptor[] = [];

  for (const info of args.mcpTools) {
    if (args.mode === "plan" && !isReadOnlyTool(info.originalName)) continue;
    descriptors.push({
      name: info.name,
      description: info.description ?? info.name,
      inputSchema: (info.inputSchema as object | undefined) ?? { type: "object", properties: {} },
      execute: async (input) => {
        const result = await getMcpManager().callTool(info.name, input ?? {});
        return clampOutput(result);
      },
    });
  }

  // --- memory tools (available in both modes) ---
  descriptors.push({
    name: "memory_save",
    description:
      "Save a durable memory about the user or project (preferences, style guides, decisions). Use for facts worth remembering across sessions.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short label, e.g. 'Brand colors'" },
        content: { type: "string", description: "The fact to remember" },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags" },
      },
      required: ["title", "content"],
    },
    execute: async ({ title, content, tags }) => {
      const entry = await saveMemory({
        title: String(title),
        content: String(content),
        tags: Array.isArray(tags) ? (tags as string[]) : undefined,
      });
      return `Saved memory "${entry.title}" (${entry.id})`;
    },
  });

  descriptors.push({
    name: "memory_search",
    description: "Search long-term memories by keywords.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", description: "Max results (default 5)" },
      },
      required: ["query"],
    },
    execute: async ({ query, limit }) => {
      const results = await searchMemories(String(query), Number(limit) || 5);
      if (results.length === 0) return "No matching memories.";
      return results.map((e) => `[${e.id}] ${e.title}: ${e.content}`).join("\n");
    },
  });

  descriptors.push({
    name: "memory_list",
    description: "List recent long-term memories.",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      const all = await listMemories();
      if (all.length === 0) return "No memories saved yet.";
      return all
        .slice(0, 20)
        .map((e) => `[${e.id}] (${e.createdAt.slice(0, 10)}) ${e.title}: ${e.content.slice(0, 120)}`)
        .join("\n");
    },
  });

  descriptors.push({
    name: "memory_delete",
    description: "Delete a memory by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    execute: async ({ id }) => {
      const ok = await deleteMemory(String(id));
      return ok ? `Deleted memory ${id}` : `Memory ${id} not found`;
    },
  });

  // --- plan tool (plan mode only) ---
  if (args.mode === "plan") {
    descriptors.push({
      name: "write_plan",
      description:
        "Write the implementation plan (goal, layout structure, palette, typography, ordered steps). Required before finishing in plan mode.",
      inputSchema: {
        type: "object",
        properties: { plan: { type: "string", description: "Markdown plan" } },
        required: ["plan"],
      },
      execute: async ({ plan }) => ({ planSaved: true, plan: String(plan) }),
    });
  }

  const toolset: ToolSet = {};
  for (const d of descriptors) {
    toolset[d.name] = tool({
      description: d.description,
      inputSchema: jsonSchema(d.inputSchema),
      execute: async (input: unknown) => d.execute((input ?? {}) as Record<string, unknown>),
    });
  }

  return { toolset, descriptors };
}
