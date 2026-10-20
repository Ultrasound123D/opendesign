/**
 * Session storage — one JSON file per session in <dataDir>/sessions/.
 * Mirrors opencode's durable session/message model (assistant messages carry
 * structured parts: text, reasoning, tool, plan) minus the event-sourced
 * SQLite layer.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Session, SessionSummary } from "../types";
import { dataDir, ensureDataDir } from "../config";

function sessionsDir(): string {
  return path.join(dataDir(), "sessions");
}

function sessionPath(id: string): string {
  // Guard against path traversal — ids are always generated UUIDs.
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid session id");
  return path.join(sessionsDir(), `${id}.json`);
}

export function newId(): string {
  return crypto.randomUUID();
}

export async function createSession(title = "New chat"): Promise<Session> {
  await ensureDataDir();
  const now = new Date().toISOString();
  const session: Session = {
    id: newId(),
    title,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    messages: [],
  };
  await fs.writeFile(sessionPath(session.id), JSON.stringify(session, null, 2), "utf-8");
  return session;
}

export async function listSessions(): Promise<SessionSummary[]> {
  await ensureDataDir();
  const files = await fs.readdir(sessionsDir());
  const sessions: SessionSummary[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(sessionsDir(), f), "utf-8");
      const s = JSON.parse(raw) as Session;
      sessions.push({
        id: s.id,
        title: s.title || "Untitled",
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        messageCount: s.messages?.length ?? 0,
        model: s.model,
      });
    } catch {
      /* skip corrupt files */
    }
  }
  return sessions.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getSession(id: string): Promise<Session | null> {
  try {
    const raw = await fs.readFile(sessionPath(id), "utf-8");
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export async function saveSession(session: Session): Promise<void> {
  session.updatedAt = new Date().toISOString();
  session.messageCount = session.messages.length;
  const tmp = `${sessionPath(session.id)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(session, null, 2), "utf-8");
  await fs.rename(tmp, sessionPath(session.id));
}

export async function deleteSession(id: string): Promise<void> {
  try {
    await fs.unlink(sessionPath(id));
  } catch {
    /* already gone */
  }
}

export async function renameSession(id: string, title: string): Promise<Session | null> {
  const session = await getSession(id);
  if (!session) return null;
  session.title = title.slice(0, 80) || "Untitled";
  await saveSession(session);
  return session;
}

export function deriveTitle(message: string): string {
  const clean = message.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean;
}
