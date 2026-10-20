/**
 * POST /api/editor/ensure — convenience launcher for a sibling OpenFigma app.
 *
 * The OpenFigma editor (which the default `openfigma` MCP server talks to via
 * EDITOR_API_URL) must be running for design tools to work. This route:
 *   1. finds the editor URL from the MCP server config (default :3111)
 *   2. returns immediately if it is already reachable
 *   3. otherwise spawns `node <openfigma>/.next/standalone/server.js` as a
 *      detached child (so it lives as long as this Next.js server process)
 *
 * This is optional convenience: you can always run the editor yourself and
 * point EDITOR_API_URL at it in Settings → MCP.
 */
import { spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import path from "node:path";
import { dataDir, readSettings } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function findOpenFigmaDir(): string | null {
  const candidates = [path.join(process.cwd(), "openfigma"), path.join(process.cwd(), "..", "openfigma")];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, ".next", "standalone", "server.js"))) return dir;
  }
  return null;
}

async function isReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(new URL("api/editor/projects", url), { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function POST() {
  const settings = await readSettings();
  const server = Object.values(settings.mcp.servers).find(
    (s) => s.type === "local" && s.environment && "EDITOR_API_URL" in s.environment,
  );
  const editorUrl =
    (server && server.type === "local" && server.environment?.EDITOR_API_URL) || "http://localhost:3111";

  if (await isReachable(editorUrl)) {
    return Response.json({ ok: true, running: true, url: editorUrl });
  }

  const dir = findOpenFigmaDir();
  if (!dir) {
    return Response.json(
      { ok: false, error: "OpenFigma app not found (expected ./openfigma with a standalone build). Run it manually and set EDITOR_API_URL in Settings → MCP." },
      { status: 404 },
    );
  }

  const port = new URL(editorUrl).port || "3111";
  const g = globalThis as typeof globalThis & { __opendesign_editor_spawning?: boolean };
  if (g.__opendesign_editor_spawning) {
    return Response.json({ ok: true, spawning: true, url: editorUrl });
  }
  g.__opendesign_editor_spawning = true;

  try {
    const logFd = openSync(path.join(dataDir(), "editor.log"), "a");
    const child = spawn(process.execPath, [path.join(dir, ".next", "standalone", "server.js")], {
      env: { ...process.env, PORT: port, HOSTNAME: "0.0.0.0", NODE_ENV: "production" },
      stdio: ["ignore", logFd, logFd],
      detached: true,
    });
    child.unref();

    // Wait for the editor to accept requests (up to 25s).
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 800));
      if (await isReachable(editorUrl)) {
        return Response.json({ ok: true, running: true, spawned: true, url: editorUrl, pid: child.pid });
      }
    }
    return Response.json(
      { ok: false, error: "Editor did not become reachable in 25s (see ~/.opendesign/editor.log)", url: editorUrl },
      { status: 504 },
    );
  } finally {
    g.__opendesign_editor_spawning = false;
  }
}
