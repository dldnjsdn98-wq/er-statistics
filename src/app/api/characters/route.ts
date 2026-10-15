import { errorResponse } from "@/lib/server/errors";
import { getCharacters } from "@/lib/server/service";

export const runtime = "nodejs";
export async function GET(): Promise<Response> {
  try { return Response.json(await getCharacters(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}
