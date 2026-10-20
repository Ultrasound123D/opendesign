/**
 * GET /api/sessions — list session summaries (most recent first).
 */
import { listSessions } from "@/lib/storage/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sessions = await listSessions();
  return Response.json({ sessions });
}
