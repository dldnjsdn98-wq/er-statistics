import "server-only";
import { Pool } from "pg";
import type { PlayerGame, TimestampPolicy } from "../types";
import { AppError } from "./errors";

export interface StoredPlayer { uid: string; nickname: string }
export interface SyncInfo { lastSyncedAt: string | null; droppedRecords: number; timestampPolicy: TimestampPolicy }
export interface Repository {
  kind: "memory" | "postgres";
  findPlayer(nickname: string): Promise<StoredPlayer | null>;
  getGames(uid: string): Promise<PlayerGame[]>;
  getSync(uid: string): Promise<SyncInfo | null>;
  upsert(player: StoredPlayer, games: PlayerGame[], info: Omit<SyncInfo, "lastSyncedAt">): Promise<void>;
}

const memoryPlayers = new Map<string, StoredPlayer>();
const memoryGames = new Map<string, Map<string, PlayerGame>>();
const memorySync = new Map<string, SyncInfo>();
const memory: Repository = {
  kind: "memory",
  async findPlayer(nickname) { return [...memoryPlayers.values()].find(player => player.nickname === nickname) ?? null; },
  async getGames(uid) { return [...(memoryGames.get(uid)?.values() ?? [])]; },
  async getSync(uid) { return memorySync.get(uid) ?? null; },
  async upsert(player, games, info) { memoryPlayers.set(player.uid, player); const map = memoryGames.get(player.uid) ?? new Map<string, PlayerGame>(); for (const game of games) { const old = map.get(game.gameId); map.set(game.gameId, old ? { ...game, matchingMode: game.matchingMode ?? old.matchingMode, rank: game.rank ?? old.rank, kills: game.kills ?? old.kills, assists: game.assists ?? old.assists, deaths: game.deaths ?? old.deaths, damage: game.damage ?? old.damage, duration: game.duration ?? old.duration } : game); } memoryGames.set(player.uid, map); memorySync.set(player.uid, { ...info, lastSyncedAt: new Date().toISOString() }); },
};

let pool: Pool | null = null;
function getPool(): Pool { if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 5000 }); return pool; }
function dbError(): AppError { return new AppError("STORAGE_UNAVAILABLE", 503, "전적 저장소에 연결하지 못했습니다."); }
function rowToGame(row: Record<string, unknown>): PlayerGame {
  return { uid: String(row.uid), gameId: String(row.game_id), startedAt: new Date(row.started_at as string).toISOString(), characterCode: Number(row.character_code), matchingMode: row.matching_mode === null ? null : Number(row.matching_mode), rank: row.game_rank === null ? null : Number(row.game_rank), kills: row.kills === null ? null : Number(row.kills), assists: row.assists === null ? null : Number(row.assists), deaths: row.deaths === null ? null : Number(row.deaths), damage: row.damage_to_player === null ? null : Number(row.damage_to_player), duration: row.play_time_seconds === null ? null : Number(row.play_time_seconds) };
}
const postgres: Repository = {
  kind: "postgres",
  async findPlayer(nickname) { try { const result = await getPool().query("SELECT uid,nickname FROM players WHERE nickname=$1 ORDER BY last_seen_at DESC LIMIT 1", [nickname]); return result.rows[0] ?? null; } catch { throw dbError(); } },
  async getGames(uid) { try { const result = await getPool().query("SELECT * FROM player_games WHERE uid=$1", [uid]); return result.rows.map(rowToGame); } catch { throw dbError(); } },
  async getSync(uid) { try { const result = await getPool().query("SELECT finished_at,dropped_records,timestamp_policy FROM sync_runs WHERE uid=$1 AND status='success' ORDER BY finished_at DESC LIMIT 1", [uid]); const row = result.rows[0]; return row ? { lastSyncedAt: new Date(row.finished_at).toISOString(), droppedRecords: Number(row.dropped_records), timestampPolicy: row.timestamp_policy as TimestampPolicy } : null; } catch { throw dbError(); } },
  async upsert(player, games, info) {
    let client; try { client = await getPool().connect(); await client.query("BEGIN");
      await client.query("INSERT INTO players(uid,nickname) VALUES($1,$2) ON CONFLICT(uid) DO UPDATE SET nickname=EXCLUDED.nickname,last_seen_at=now()", [player.uid, player.nickname]);
      for (const game of games) await client.query(`INSERT INTO player_games(uid,game_id,started_at,character_code,matching_mode,game_rank,kills,assists,deaths,damage_to_player,play_time_seconds)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(uid,game_id) DO UPDATE SET
        started_at=EXCLUDED.started_at,character_code=EXCLUDED.character_code,matching_mode=COALESCE(EXCLUDED.matching_mode,player_games.matching_mode),
        game_rank=COALESCE(EXCLUDED.game_rank,player_games.game_rank),kills=COALESCE(EXCLUDED.kills,player_games.kills),
        assists=COALESCE(EXCLUDED.assists,player_games.assists),deaths=COALESCE(EXCLUDED.deaths,player_games.deaths),
        damage_to_player=COALESCE(EXCLUDED.damage_to_player,player_games.damage_to_player),play_time_seconds=COALESCE(EXCLUDED.play_time_seconds,player_games.play_time_seconds),ingested_at=now()`,
        [game.uid,game.gameId,game.startedAt,game.characterCode,game.matchingMode,game.rank,game.kills,game.assists,game.deaths,game.damage,game.duration]);
      await client.query("INSERT INTO sync_runs(uid,finished_at,status,record_count,dropped_records,completeness,timestamp_policy) VALUES($1,now(),'success',$2,$3,'partial',$4)", [player.uid,games.length,info.droppedRecords,info.timestampPolicy]);
      await client.query("COMMIT");
    } catch { if (client) await client.query("ROLLBACK").catch(() => {}); throw dbError(); } finally { client?.release(); }
  },
};

export function repository(): Repository { return process.env.DATABASE_URL ? postgres : memory; }
