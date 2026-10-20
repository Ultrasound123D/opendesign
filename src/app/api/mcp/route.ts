/**
 * GET  /api/mcp — server statuses + discovered tools (triggers connect).
 * POST /api/mcp — force reload (re-read settings, reconnect changed servers).
 */
import { getMcpManager } from "@/lib/mcp/manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const manager = getMcpManager();
  const statuses = await manager.statuses();
  return Response.json({ statuses });
}

export async function POST() {
  const manager = getMcpManager();
  await manager.reload();
  const statuses = await manager.statuses();
  return Response.json({ statuses });
}
