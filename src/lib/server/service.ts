import "server-only";
import { buildStats, deduplicate, filterGames, kstBounds } from "../domain";
import { DEMO_CHARACTERS, DEMO_PLAYER, demoCoverage, demoGames } from "../demo";
import type { Character, CharactersResponse, PlayerGame, Query, StatsResponse, TimestampPolicy } from "../types";
import { AppError } from "./errors";
import { ExpiringCache } from "./cache";
import { fetchCharacters, fetchUserGames, resolvePlayer } from "./official";
import { repository, type StoredPlayer } from "./repository";

export function dataSource(): "demo" | "live" {
  const setting = (process.env.ER_DATA_SOURCE ?? "demo").trim().toLowerCase();
  if (setting !== "demo" && setting !== "live") throw new AppError("LIVE_NOT_CONFIGURED", 503, "ER_DATA_SOURCE 설정이 올바르지 않습니다.");
  return setting;
}

const playerCache = new ExpiringCache<StoredPlayer>(500);
const lookupFailures = new ExpiringCache<{ error: AppError; at: number }>(500);
const pendingPlayers = new Map<string, Promise<StoredPlayer>>();
const pendingSyncs = new Map<string, Promise<void>>();
let metadataCache: { at: number; characters: Character[] } | null = null;
let pendingMetadata: Promise<CharactersResponse> | null = null;
let metadataRetryAt = 0;
const fallbackCodes = new Set(["UPSTREAM_TIMEOUT", "UPSTREAM_UNAVAILABLE", "RATE_LIMITED", "REQUEST_QUEUE_FULL"]);

function appError(error: unknown): AppError {
  return error instanceof AppError ? error : new AppError("UPSTREAM_UNAVAILABLE", 502, "공식 API에 연결하지 못했습니다.");
}
function retrySeconds(error: unknown): number | null {
  return error instanceof AppError ? error.retryAfterSeconds : null;
}
function metadataFallback(): CharactersResponse {
  return { source: "live", characters: metadataCache?.characters ?? [], status: metadataCache ? "stale" : "unavailable",
    lastUpdatedAt: metadataCache ? new Date(metadataCache.at).toISOString() : null,
    retryAfterSeconds: Math.max(0, Math.ceil((metadataRetryAt - Date.now()) / 1000)) };
}
async function liveCharacters(): Promise<CharactersResponse> {
  if (metadataCache && Date.now() - metadataCache.at >= 7 * 86400000) metadataCache = null;
  if (metadataCache && Date.now() - metadataCache.at < 86400000) {
    return { source: "live", characters: metadataCache.characters, status: "fresh", lastUpdatedAt: new Date(metadataCache.at).toISOString(), retryAfterSeconds: null };
  }
  if (Date.now() < metadataRetryAt) return metadataFallback();
  if (pendingMetadata) return pendingMetadata;
  pendingMetadata = (async () => {
    try {
      const characters = await fetchCharacters();
      metadataCache = { at: Date.now(), characters };
      metadataRetryAt = 0;
      return { source: "live" as const, characters, status: "fresh" as const, lastUpdatedAt: new Date(metadataCache.at).toISOString(), retryAfterSeconds: null };
    } catch (error) {
      metadataRetryAt = Date.now() + Math.max(15, retrySeconds(error) ?? 15) * 1000;
      // Retain metadata for at most seven days, including outages.
      if (metadataCache && Date.now() - metadataCache.at >= 7 * 86400000) metadataCache = null;
      return metadataFallback();
    }
  })();
  try { return await pendingMetadata; } finally { pendingMetadata = null; }
}
export async function getCharacters(): Promise<CharactersResponse> {
  const source = dataSource();
  if (source === "demo") return { source, characters: DEMO_CHARACTERS, status: "fresh", lastUpdatedAt: null, retryAfterSeconds: null };
  if (!process.env.ER_API_KEY) throw new AppError("LIVE_NOT_CONFIGURED", 503, "실제 API 키가 설정되지 않았습니다.");
  return liveCharacters();
}
async function lookupPlayer(nickname: string): Promise<StoredPlayer> {
  const cached = playerCache.get(nickname);
  if (cached) return cached;
  const failure = lookupFailures.get(nickname);
  if (failure) throw new AppError(failure.error.code, failure.error.status, failure.error.message, failure.error.retryAfterSeconds === null ? null : Math.max(0, failure.error.retryAfterSeconds - Math.floor((Date.now() - failure.at) / 1000)));
  const existing = pendingPlayers.get(nickname);
  if (existing) return existing;
  if (pendingPlayers.size >= 32) throw new AppError("REQUEST_QUEUE_FULL", 503, "조회 요청이 많습니다. 잠시 후 다시 시도해 주세요.", 1);
  const task = (async () => {
    try {
      const player = await resolvePlayer(nickname);
      playerCache.set(nickname, player, 60000);
      lookupFailures.delete(nickname);
      return player;
    } catch (error) {
      playerCache.delete(nickname);
      const failure = appError(error);
      // Short failure backoff; no durable nickname-to-UID association on a failed lookup.
      lookupFailures.set(nickname, { error: failure, at: Date.now() }, 5000);
      throw failure;
    }
  })();
  pendingPlayers.set(nickname, task);
  try { return await task; } finally { pendingPlayers.delete(nickname); }
}
async function getPlayer(nickname: string, repo: ReturnType<typeof repository>): Promise<{ player: StoredPlayer; stale: boolean; retryAfterSeconds: number | null }> {
  try { return { player: await lookupPlayer(nickname), stale: false, retryAfterSeconds: null }; }
  catch (error) {
    // An unresolved/forbidden identity must not silently return a previous nickname owner.
    if (!(error instanceof AppError) || !fallbackCodes.has(error.code)) throw error;
    const stored = await repo.findPlayer(nickname);
    if (stored && (await repo.getSync(stored.uid))?.lastSyncedAt) return { player: stored, stale: true, retryAfterSeconds: retrySeconds(error) };
    throw error;
  }
}

async function syncPlayer(player: StoredPlayer, repo: ReturnType<typeof repository>): Promise<void> {
  const existing = pendingSyncs.get(player.uid);
  if (existing) return existing;
  const task = (async () => {
    const result = await fetchUserGames(player.uid, process.env.ER_API_TIME_ZONE);
    await repo.upsert(player, deduplicate(result.games), { droppedRecords: result.dropped, timestampPolicy: result.timestampPolicy });
  })();
  pendingSyncs.set(player.uid, task);
  try { await task; } finally { pendingSyncs.delete(player.uid); }
}

function liveCoverage(input: { games: PlayerGame[]; query: Query; lastSyncedAt: string | null; droppedRecords: number; stale: boolean; storage: "memory" | "postgres"; metadata: CharactersResponse; retryAfterSeconds: number | null }): StatsResponse["coverage"] {
  const { games, query, lastSyncedAt, droppedRecords, stale, storage, metadata } = input;
  const sorted = games.map(game => game.startedAt).sort();
  const timestampPolicies = [...new Set(filterGames(games, query).map(game => game.timestampPolicy ?? "unknown"))].sort() as TimestampPolicy[];
  const timestampPolicy = timestampPolicies.find(policy => policy.startsWith("assumed")) ?? timestampPolicies.find(policy => policy === "unknown") ?? "explicit-offset";
  const retryAfterSeconds = Math.max(input.retryAfterSeconds ?? 0, metadata.retryAfterSeconds ?? 0) || null;
  const warnings: StatsResponse["coverage"]["warnings"] = [
    { code: "PARTIAL_HISTORY", message: "공식 API의 전체 페이지 수와 수집 완료 범위를 확인하지 못해 이 전적은 일부일 수 있습니다." },
    { code: "NICKNAME_UID_LIMITATION", message: "닉네임 변경 시 UID가 바뀌어 이전 닉네임의 게임이 제외될 수 있습니다." },
  ];
  const { startInclusive } = kstBounds(query.startDate, query.endDate);
  if (Date.parse(startInclusive) < Date.now() - 90 * 86400000) warnings.push({ code: "OUTSIDE_API_RETENTION", message: "공식 API는 최근 90일을 제공합니다. 이전 게임은 앱이 수집해 보관한 경우에만 표시됩니다." });
  if (storage === "memory") warnings.push({ code: "EPHEMERAL_STORAGE", message: "메모리에는 최대 200명·사용자당 최근 10,000경기를 임시 보관합니다. 24시간 미사용 또는 서버 재시작 시 기록이 사라집니다." });
  if (stale) warnings.push({ code: "STALE_DATA", message: "공식 API 조회에 실패해 마지막으로 성공한 수집 결과를 표시합니다. 현재 닉네임·UID와 다를 수 있습니다." });
  if (droppedRecords) warnings.push({ code: "DROPPED_RECORDS", message: droppedRecords + "개의 불완전한 게임 기록을 제외했습니다." });
  for (const policy of timestampPolicies) {
    if (policy.startsWith("assumed")) warnings.push({ code: "TIMESTAMP_" + policy, message: "일부 경기의 시간대 없는 시각을 " + (policy === "assumed-Asia/Seoul" ? "한국 시간" : "UTC") + "으로 해석했습니다." });
    if (policy === "unknown") warnings.push({ code: "TIMESTAMP_UNKNOWN", message: "일부 기존 경기에는 시각의 해석 정책이 기록되지 않았습니다." });
  }
  if (metadata.status !== "fresh") warnings.push({ code: "METADATA_" + metadata.status.toUpperCase(), message: metadata.status === "stale" ? "실험체 목록 갱신에 실패해 이전 이름 정보를 표시합니다." : "실험체 목록을 불러오지 못해 관측된 코드로 표시합니다." });
  return { completeness: "partial", upstreamRetentionDays: 90, observedFrom: sorted.at(0) ?? null, observedTo: sorted.at(-1) ?? null, lastSyncedAt, stale, droppedRecords, timestampPolicy, timestampPolicies, metadataStatus: metadata.status, retryAfterSeconds, retryAt: retryAfterSeconds ? new Date(Date.now() + retryAfterSeconds * 1000).toISOString() : null, warnings };
}

export async function getStats(query: Query): Promise<StatsResponse> {
  if (dataSource() === "demo") {
    const games = demoGames();
    return buildStats({ source: "demo", storage: "fixture", player: DEMO_PLAYER, query, games, characters: DEMO_CHARACTERS, coverage: demoCoverage(games) });
  }
  if (!process.env.ER_API_KEY) throw new AppError("LIVE_NOT_CONFIGURED", 503, "실제 API 키가 설정되지 않았습니다.");
  const repo = repository();
  const resolved = await getPlayer(query.nickname, repo);
  const player = resolved.player;
  let stale = resolved.stale, retryAfterSeconds = resolved.retryAfterSeconds;
  const previous = await repo.getSync(player.uid);
  if (!stale && (!previous?.lastSyncedAt || Date.now() - Date.parse(previous.lastSyncedAt) >= 60000)) {
    try { await syncPlayer(player, repo); }
    catch (error) {
      if (!previous?.lastSyncedAt || !(error instanceof AppError) || !fallbackCodes.has(error.code)) throw error;
      stale = true;
      retryAfterSeconds = retrySeconds(error);
    }
  }
  const games = await repo.getGames(player.uid);
  const sync = await repo.getSync(player.uid);
  if (!sync?.lastSyncedAt) throw new AppError("UPSTREAM_UNAVAILABLE", 502, "성공적으로 수집한 전적이 없습니다. 다시 조회해 주세요.");
  const metadata = await liveCharacters();
  return buildStats({ query, games, characters: metadata.characters, source: "live", storage: repo.kind, player, coverage: liveCoverage({ games, query, lastSyncedAt: sync.lastSyncedAt, droppedRecords: sync.droppedRecords, stale, storage: repo.kind, metadata, retryAfterSeconds }) });
}
