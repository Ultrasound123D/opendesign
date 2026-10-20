/**
 * Long-term memory store — the "ذاكرة" feature.
 *
 * opencode v2 has no memory subsystem (context comes from AGENTS.md/skills);
 * opendesign adds an explicit memory store with model-facing tools
 * (memory_save / memory_search / memory_list / memory_delete). Recent entries
 * are auto-injected into the system prompt; the model can search and persist
 * durable knowledge (design preferences, project decisions, style guides).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { MemoryEntry } from "../types";
import { dataDir, ensureDataDir } from "../config";

function memoryPath(): string {
  return path.join(dataDir(), "memory.json");
}

async function readAll(): Promise<MemoryEntry[]> {
  try {
    const raw = await fs.readFile(memoryPath(), "utf-8");
    const parsed = JSON.parse(raw) as MemoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(entries: MemoryEntry[]): Promise<void> {
  await ensureDataDir();
  const tmp = `${memoryPath()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(entries, null, 2), "utf-8");
  await fs.rename(tmp, memoryPath());
}

export async function listMemories(): Promise<MemoryEntry[]> {
  const all = await readAll();
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function saveMemory(input: {
  title: string;
  content: string;
  tags?: string[];
}): Promise<MemoryEntry> {
  const all = await readAll();
  const entry: MemoryEntry = {
    id: crypto.randomUUID(),
    title: input.title.slice(0, 120),
    content: input.content.slice(0, 4000),
    tags: (input.tags ?? []).slice(0, 10),
    createdAt: new Date().toISOString(),
  };
  all.push(entry);
  await writeAll(all);
  return entry;
}

export async function deleteMemory(id: string): Promise<boolean> {
  const all = await readAll();
  const next = all.filter((e) => e.id !== id);
  if (next.length === all.length) return false;
  await writeAll(next);
  return true;
}

/** Lightweight lexical search (no embeddings — honest, dependency-free). */
export async function searchMemories(query: string, limit = 5): Promise<MemoryEntry[]> {
  const terms = query
    .toLowerCase()
    .split(/[\s,،]+/)
    .filter((t) => t.length > 2);
  const all = await readAll();
  const scored = all
    .map((e) => {
      const hay = `${e.title} ${e.content} ${e.tags.join(" ")}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (hay.includes(t)) score += 1;
        if (e.tags.some((tag) => tag.toLowerCase() === t)) score += 2;
      }
      return { e, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ e }) => e);
}

/** Format memories for system-prompt injection (most recent first). */
export async function formatMemoriesForPrompt(max = 10): Promise<string> {
  const all = await listMemories();
  if (all.length === 0) return "";
  const slice = all.slice(0, max);
  const lines = slice.map((e) => `- [${e.createdAt.slice(0, 10)}] ${e.title}: ${e.content.slice(0, 200)}`);
  return `## Long-term memory (most recent ${slice.length} of ${all.length})\n${lines.join("\n")}\n\nUse memory_search for older memories. Save durable user preferences and project decisions with memory_save.`;
}
