/**
 * GET /api/providers — full provider catalog (models.dev + custom + built-in)
 * with key/endpoint status. `stale=true` means the catalog came from disk
 * cache or the offline fallback.
 */
import { listProviders } from "@/lib/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { providers, stale } = await listProviders();
  return Response.json({ providers, stale });
}
