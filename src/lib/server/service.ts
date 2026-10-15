import "server-only";
import { buildStats, deduplicate, kstBounds } from "../domain";
import { DEMO_CHARACTERS, DEMO_PLAYER, demoCoverage, demoGames } from "../demo";
import type { Character, PlayerGame, Query, StatsResponse } from "../types";
import { AppError } from "./errors";
import { fetchCharacters, fetchUserGames, resolvePlayer } from "./official";
import { repository, type StoredPlayer } from "./repository";

export function dataSource(): "demo" | "live" {
  const setting = (process.env.ER_DATA_SOURCE ?? "demo").trim().toLowerCase();
  if (setting !== "demo" && setting !== "live") throw new AppError("LIVE_NOT_CONFIGURED", 503, "ER_DATA_SOURCE 설정이 올바르지 않습니다.");
  return setting;
}

const playerCache = new Map<string, { at: number; player: StoredPlayer }>();
const pendingSyncs = new Map<string, Promise<void>>();
let metadataCache: { at: number; characters: Character[] } | null = null;

async function liveCharacters(): Promise<Character[]> {
  if (metadataCache && Date.now() - metadataCache.at < 86400000) return metadataCache.characters;
  try { const characters = await fetchCharacters(); metadataCache = { at: Date.now(), characters }; return characters; }
  catch { return metadataCache?.characters ?? []; }
}

export async function getCharacters(): Promise<{ source: "demo" | "live"; characters: Character[] }> {
  const source = dataSource();
  if (source === "demo") return { source, characters: DEMO_CHARACTERS };
  if (!process.env.ER_API_KEY) throw new AppError("LIVE_NOT_CONFIGURED", 503, "실제 API 키가 설정되지 않았습니다.");
  return { source, characters: await liveCharacters() };
}

async function getPlayer(nickname: string, repo: ReturnType<typeof repository>): Promise<{ player: StoredPlayer; stale: boolean }> {
  const cached = playerCache.get(nickname);
  if (cached && Date.now() - cached.at < 60000) return { player: cached.player, stale: false };
  try { const player = await resolvePlayer(nickname); playerCache.set(nickname, { at: Date.now(), player }); return { player, stale: false }; }
  catch (error) {
    const stored = cached?.player ?? await repo.findPlayer(nickname);
    if (stored) return { player: stored, stale: true };
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

function liveCoverage(input: { games: PlayerGame[]; query: Query; lastSyncedAt: string | null; droppedRecords: number; timestampPolicy: StatsResponse["coverage"]["timestampPolicy"]; stale: boolean; storage: "memory" | "postgres" }): StatsResponse["coverage"] {
  const { games, query, lastSyncedAt, droppedRecords, timestampPolicy, stale, storage } = input;
  const sorted = games.map(game => game.startedAt).sort();
  const warnings: StatsResponse["coverage"]["warnings"] = [
    { code: "PARTIAL_HISTORY", message: "공식 API의 전체 페이지 수와 수집 완료 범위를 확인하지 못해 이 전적은 일부일 수 있습니다." },
    { code: "NICKNAME_UID_LIMITATION", message: "닉네임 변경 시 UID가 바뀌어 이전 닉네임의 게임이 제외될 수 있습니다." },
  ];
  const { startInclusive } = kstBounds(query.startDate, query.endDate);
  if (Date.parse(startInclusive) < Date.now() - 90 * 86400000) warnings.push({ code: "OUTSIDE_API_RETENTION", message: "공식 API는 최근 90일을 제공합니다. 이전 게임은 앱이 수집해 보관한 경우에만 표시됩니다." });
  if (storage === "memory") warnings.push({ code: "EPHEMERAL_STORAGE", message: "메모리 저장소 사용 중입니다. 서버 재시작 시 수집 기록이 사라집니다." });
  if (stale) warnings.push({ code: "STALE_DATA", message: "공식 API 조회에 실패해 마지막으로 저장된 실제 전적을 표시합니다." });
  if (droppedRecords) warnings.push({ code: "DROPPED_RECORDS", message: `${droppedRecords}개의 불완전한 게임 기록을 제외했습니다.` });
  if (timestampPolicy.startsWith("assumed")) warnings.push({ code: "TIMESTAMP_ASSUMPTION", message: `공식 API의 시간대 없는 시각을 ${timestampPolicy === "assumed-Asia/Seoul" ? "한국 시간" : "UTC"}으로 해석했습니다.` });
  return { completeness: "partial", upstreamRetentionDays: 90, observedFrom: sorted.at(0) ?? null, observedTo: sorted.at(-1) ?? null, lastSyncedAt, stale, droppedRecords, timestampPolicy, warnings };
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
  let stale = resolved.stale;
  const previous = await repo.getSync(player.uid);
  if (!stale && (!previous?.lastSyncedAt || Date.now() - Date.parse(previous.lastSyncedAt) >= 60000)) {
    try { await syncPlayer(player, repo); }
    catch (error) { if ((await repo.getGames(player.uid)).length === 0) throw error; stale = true; }
  }
  const games = await repo.getGames(player.uid);
  const sync = await repo.getSync(player.uid);
  const characters = await liveCharacters();
  return buildStats({ query, games, characters, source: "live", storage: repo.kind, player, coverage: liveCoverage({ games, query, lastSyncedAt: sync?.lastSyncedAt ?? null, droppedRecords: sync?.droppedRecords ?? 0, timestampPolicy: sync?.timestampPolicy ?? "explicit-offset", stale, storage: repo.kind }) });
}
