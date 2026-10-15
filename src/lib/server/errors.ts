import "server-only";

export class AppError extends Error {
  constructor(public code: string, public status: number, message: string, public retryAfterSeconds: number | null = null) { super(message); }
}

export function errorResponse(error: unknown): Response {
  const app = error instanceof AppError ? error : new AppError("UPSTREAM_UNAVAILABLE", 502, "전적 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  const headers: HeadersInit = { "Cache-Control": "no-store" };
  if (app.retryAfterSeconds !== null) headers["Retry-After"] = String(app.retryAfterSeconds);
  return Response.json({ error: { code: app.code, message: app.message, fields: {}, retryAfterSeconds: app.retryAfterSeconds } }, { status: app.status, headers });
}
