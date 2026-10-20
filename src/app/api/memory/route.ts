/**
 * GET    /api/memory        — list memories
 * POST   /api/memory        — create a memory manually ({ title, content, tags })
 * DELETE /api/memory?id=... — delete a memory
 */
import { deleteMemory, listMemories, saveMemory } from "@/lib/storage/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const memories = await listMemories();
  return Response.json({ memories });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    content?: string;
    tags?: string[];
  };
  if (!body.title?.trim() || !body.content?.trim()) {
    return Response.json({ error: "title and content are required" }, { status: 400 });
  }
  const entry = await saveMemory({
    title: body.title,
    content: body.content,
    tags: body.tags,
  });
  return Response.json({ memory: entry });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  const ok = await deleteMemory(id);
  return Response.json({ ok });
}
