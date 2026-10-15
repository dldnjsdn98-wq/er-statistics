import { QueryError, parseQuery } from "@/lib/domain";
import { errorResponse } from "@/lib/server/errors";
import { getStats } from "@/lib/server/service";

export const runtime = "nodejs";
export async function GET(request: Request): Promise<Response> {
  try { const query = parseQuery(new URL(request.url).searchParams); return Response.json(await getStats(query), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    if (error instanceof QueryError) return Response.json({ error: { code: "INVALID_QUERY", message: error.message, fields: error.fields, retryAfterSeconds: null } }, { status: 400, headers: { "Cache-Control": "no-store" } });
    return errorResponse(error);
  }
}
