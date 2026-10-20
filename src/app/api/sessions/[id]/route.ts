/**
 * GET    /api/sessions/:id — full session (messages + plan)
 * PATCH  /api/sessions/:id — rename ({ title })
 * DELETE /api/sessions/:id — delete session file
 */
import { deleteSession, getSession, renameSession } from "@/lib/storage/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) return Response.json({ error: "Session not found" }, { status: 404 });
  return Response.json({ session });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { title?: string };
  if (!body.title?.trim()) return Response.json({ error: "title is required" }, { status: 400 });
  const session = await renameSession(id, body.title);
  if (!session) return Response.json({ error: "Session not found" }, { status: 404 });
  return Response.json({ session });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteSession(id);
  return Response.json({ ok: true });
}
