import "server-only";
import type { Character, PlayerGame, TimestampPolicy } from "../types";
import { AppError } from "./errors";

const BASE = "https://open-api.bser.io";
let requestQueue: Promise<void> = Promise.resolve();
let lastCall = 0;

async function officialGet(path: string): Promise<unknown> {
  const key = process.env.ER_API_KEY;
  if (!key) throw new AppError("LIVE_NOT_CONFIGURED", 503, "실제 API 키가 설정되지 않았습니다.");
  const previous = requestQueue;
  let unlock!: () => void;
  requestQueue = new Promise<void>(resolve => { unlock = resolve; });
  await previous;
  try {
    const delay = Math.max(0, 1000 - (Date.now() - lastCall));
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    lastCall = Date.now();
    let response: Response;
    try { response = await fetch(`${BASE}${path}`, { headers: { "x-api-key": key, Accept: "application/json" }, signal: AbortSignal.timeout(8000), cache: "no-store" }); }
    catch (cause) { if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) throw new AppError("UPSTREAM_TIMEOUT", 504, "공식 API 응답 시간이 초과되었습니다."); throw new AppError("UPSTREAM_UNAVAILABLE", 502, "공식 API에 연결하지 못했습니다."); }
    if (response.status === 404) throw new AppError("PLAYER_NOT_FOUND", 404, "닉네임에 해당하는 플레이어를 찾지 못했습니다.");
    if (response.status === 429) { const retry = Number(response.headers.get("retry-after")); throw new AppError("RATE_LIMITED", 429, "공식 API 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.", Number.isFinite(retry) && retry > 0 ? Math.min(retry, 3600) : 60); }
    if (response.status === 401 || response.status === 403) throw new AppError("UPSTREAM_AUTH_FAILED", 502, "공식 API 인증에 실패했습니다. 서버 설정을 확인해 주세요.");
    if (!response.ok) throw new AppError("UPSTREAM_UNAVAILABLE", 502, "공식 API가 전적을 제공하지 못했습니다.");
    try { return await response.json(); } catch { throw new AppError("UPSTREAM_UNAVAILABLE", 502, "공식 API 응답 형식이 올바르지 않습니다."); }
  } finally { unlock(); }
}

function object(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function safeId(value: unknown): string | null { return typeof value === "string" && /^\d+$/.test(value) ? value : typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : null; }
function safeUid(value: unknown): string | null { return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : null; }
function positiveInt(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null; }
function optionalNumber(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null; }
function optionalInteger(value: unknown, minimum = 0): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum ? value : null; }

export function parseOfficialTimestamp(value: unknown, timeZone: string | undefined): { iso: string; policy: TimestampPolicy } {
  if (typeof value !== "string") throw new Error("invalid timestamp");
  const trimmed = value.trim();
  let candidate = trimmed.replace(" ", "T");
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(candidate);
  if (!parts) throw new Error("invalid timestamp");
  const [, y, m, d, h, min, s] = parts.map(Number);
  const calendar = new Date(Date.UTC(y, m - 1, d));
  if (calendar.getUTCFullYear() !== y || calendar.getUTCMonth() + 1 !== m || calendar.getUTCDate() !== d || h > 23 || min > 59 || s > 59) throw new Error("invalid timestamp");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(candidate)) {
    const parsed = new Date(candidate); if (Number.isNaN(parsed.getTime())) throw new Error("invalid timestamp");
    return { iso: parsed.toISOString(), policy: "explicit-offset" };
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(candidate)) throw new Error("invalid timestamp");
  if (timeZone !== "Asia/Seoul" && timeZone !== "UTC") throw new AppError("UPSTREAM_TIMEZONE_REQUIRED", 503, "공식 API 시각의 시간대 설정이 필요합니다. ER_API_TIME_ZONE을 설정해 주세요.");
  const offset = timeZone === "Asia/Seoul" ? "+09:00" : "Z";
  candidate += offset;
  const parsed = new Date(candidate); if (Number.isNaN(parsed.getTime())) throw new Error("invalid timestamp");
  return { iso: parsed.toISOString(), policy: timeZone === "Asia/Seoul" ? "assumed-Asia/Seoul" : "assumed-UTC" };
}

export function normalizeUserGames(value: unknown, uid: string, timeZone: string | undefined): { games: PlayerGame[]; dropped: number; timestampPolicy: TimestampPolicy } {
  const envelope = object(value), rows = envelope?.userGames;
  if (envelope?.error || (typeof envelope?.code === "number" && envelope.code !== 0 && envelope.code !== 200)) throw new AppError("UPSTREAM_UNAVAILABLE", 502, "공식 API 오류 응답을 받았습니다.");
  if (!Array.isArray(rows)) throw new AppError("UPSTREAM_UNAVAILABLE", 502, "공식 게임 응답 형식이 올바르지 않습니다.");
  const games: PlayerGame[] = []; let dropped = 0; let timestampPolicy: TimestampPolicy = "explicit-offset";
  for (const row of rows) {
    const raw = object(row); const gameId = safeId(raw?.gameId), characterCode = positiveInt(raw?.characterNum);
    if (!raw || !gameId || !characterCode) { dropped++; continue; }
    let startedAt: string;
    try { const timestamp = parseOfficialTimestamp(raw.startDtm, timeZone); startedAt = timestamp.iso; if (timestamp.policy !== "explicit-offset") timestampPolicy = timestamp.policy; }
    catch (cause) { if (cause instanceof AppError) throw cause; dropped++; continue; }
    games.push({ uid, gameId, startedAt, characterCode, matchingMode: optionalInteger(raw.matchingMode), rank: optionalInteger(raw.gameRank, 1), kills: optionalInteger(raw.playerKill), assists: optionalInteger(raw.playerAssistant), deaths: optionalInteger(raw.playerDeaths), damage: optionalNumber(raw.damageToPlayer), duration: optionalInteger(raw.playTime) });
  }
  return { games, dropped, timestampPolicy };
}

export async function resolvePlayer(nickname: string): Promise<{ uid: string; nickname: string }> {
  const value = object(await officialGet(`/v1/user/nickname?${new URLSearchParams({ query: nickname })}`));
  if (value?.error || (typeof value?.code === "number" && value.code !== 0 && value.code !== 200)) throw new AppError("UPSTREAM_UNAVAILABLE", 502, "공식 API 오류 응답을 받았습니다.");
  const user = object(value?.user), uid = safeUid(user?.uid), name = user?.nickname;
  if (!uid || typeof name !== "string" || !name.trim()) throw new AppError("PLAYER_NOT_FOUND", 404, "닉네임에 해당하는 플레이어를 찾지 못했습니다.");
  return { uid, nickname: name };
}

export async function fetchUserGames(uid: string, timeZone: string | undefined) { return normalizeUserGames(await officialGet(`/v1/user/games/uid/${encodeURIComponent(uid)}`), uid, timeZone); }

export async function fetchCharacters(): Promise<Character[]> {
  const value = object(await officialGet("/v2/data/Character"));
  const rows = value?.data;
  if (!Array.isArray(rows)) throw new AppError("UPSTREAM_UNAVAILABLE", 502, "실험체 메타데이터 형식이 올바르지 않습니다.");
  const characters: Character[] = [];
  for (const row of rows) { const item = object(row), code = positiveInt(item?.code ?? item?.characterNum); if (code) characters.push({ code, name: typeof item?.name === "string" && item.name ? item.name : `캐릭터 ${code}` }); }
  return [...new Map(characters.map(character => [character.code, character])).values()].sort((a, b) => a.code - b.code);
}
