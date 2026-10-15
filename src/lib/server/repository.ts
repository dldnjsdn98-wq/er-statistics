import "server-only";
import { Pool } from "pg";
import type { PlayerGame, TimestampPolicy } from "../types";
import { AppError } from "./errors";
import { deduplicate, mergeDuplicate } from "../domain";

export interface StoredPlayer { uid: string; nickname: string }
export interface SyncInfo { lastSyncedAt: string | null; droppedRecords: number; timestampPolicy: TimestampPolicy }
export interface Repository {
  kind: "memory" | "postgres";
  findPlayer(nickname: string): Promise<StoredPlayer | null>;
  getGames(uid: string): Promise<PlayerGame[]>;
  getSync(uid: string): Promise<SyncInfo | null>;
  upsert(player: StoredPlayer, games: PlayerGame[], info: Omit<SyncInfo, "lastSyncedAt">): Promise<void>;
}

export function createMemoryRepository(options: { now?: () => number; maxPlayers?: number; maxGamesPerPlayer?: number; ttlMs?: number } = {}): Repository {
  const now = options.now ?? Date.now;
  const maxPlayers = options.maxPlayers ?? 200, maxGames = options.maxGamesPerPlayer ?? 10000, ttl = options.ttlMs ?? 86400000;
  if (![maxPlayers, maxGames, ttl].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("Invalid memory repository limits");
  const entries = new Map<string, { player: StoredPlayer; games: Map<string, PlayerGame>; sync: SyncInfo; usedAt: number }>();
  function sweep() { for (const [uid, item] of entries) if (now() - item.usedAt >= ttl) entries.delete(uid); }
  function get(uid: string) {
    sweep();
    const item = entries.get(uid);
    if (item) { item.usedAt = now(); entries.delete(uid); entries.set(uid, item); }
    return item;
  }
  return {
    kind: "memory",
    async findPlayer(nickname) {
      sweep();
      const item = [...entries.values()].reverse().find(entry => entry.player.nickname === nickname);
      if (!item) return null;
      get(item.player.uid);
      return { ...item.player };
    },
    async getGames(uid) { return [...(get(uid)?.games.values() ?? [])].map(game => ({ ...game })); },
    async getSync(uid) { const sync = get(uid)?.sync; return sync ? { ...sync } : null; },
    async upsert(player, games, info) {
      if (games.some(game => game.uid !== player.uid)) throw dbError();
      const old = get(player.uid), merged = new Map(old?.games);
      for (const game of deduplicate(games)) {
        const previous = merged.get(game.gameId);
        if (previous && (previous.startedAt !== game.startedAt || previous.characterCode !== game.characterCode || (previous.matchingMode !== null && game.matchingMode !== null && previous.matchingMode !== game.matchingMode))) continue;
        merged.set(game.gameId, previous ? { ...mergeDuplicate(game, previous), timestampPolicy: previous.timestampPolicy ?? "unknown" } : { ...game, timestampPolicy: game.timestampPolicy ?? "unknown" });
      }
      const recent = [...merged.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.gameId.localeCompare(a.gameId)).slice(0, maxGames);
      entries.delete(player.uid);
      entries.set(player.uid, { player: { ...player }, games: new Map(recent.map(game => [game.gameId, game])), sync: { ...info, lastSyncedAt: new Date(now()).toISOString() }, usedAt: now() });
      while (entries.size > maxPlayers) entries.delete(entries.keys().next().value!);
    },
  };
}
const memory = createMemoryRepository();

let pool: Pool | null = null;
function getPool(): Pool { if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 5000 }); return pool; }
function dbError(): AppError { return new AppError("STORAGE_UNAVAILABLE", 503, "전적 저장소에 연결하지 못했습니다."); }
function rowToGame(row: Record<string, unknown>): PlayerGame {
  return { timestampPolicy: (["explicit-offset", "assumed-Asia/Seoul", "assumed-UTC", "demo"].includes(String(row.timestamp_policy)) ? row.timestamp_policy : "unknown") as TimestampPolicy, uid: String(row.uid), gameId: String(row.game_id), startedAt: new Date(row.started_at as string).toISOString(), characterCode: Number(row.character_code), matchingMode: row.matching_mode === null ? null : Number(row.matching_mode), rank: row.game_rank === null ? null : Number(row.game_rank), kills: row.kills === null ? null : Number(row.kills), assists: row.assists === null ? null : Number(row.assists), deaths: row.deaths === null ? null : Number(row.deaths), damage: row.damage_to_player === null ? null : Number(row.damage_to_player), duration: row.play_time_seconds === null ? null : Number(row.play_time_seconds) };
}
const postgres: Repository = {
  kind: "postgres",
  async findPlayer(nickname) { try { const result = await getPool().query("SELECT uid,nickname FROM players WHERE nickname=$1 ORDER BY last_seen_at DESC LIMIT 1", [nickname]); return result.rows[0] ?? null; } catch { throw dbError(); } },
  async getGames(uid) { try { const result = await getPool().query("SELECT uid,game_id,started_at,character_code,matching_mode,game_rank,kills,assists,deaths,damage_to_player,play_time_seconds,timestamp_policy FROM player_games WHERE uid=$1", [uid]); return result.rows.map(rowToGame); } catch { throw dbError(); } },
  async getSync(uid) { try { const result = await getPool().query("SELECT finished_at,dropped_records,timestamp_policy FROM sync_runs WHERE uid=$1 AND status='success' ORDER BY finished_at DESC,id DESC LIMIT 1", [uid]); const row = result.rows[0]; return row ? { lastSyncedAt: new Date(row.finished_at).toISOString(), droppedRecords: Number(row.dropped_records), timestampPolicy: row.timestamp_policy as TimestampPolicy } : null; } catch { throw dbError(); } },
  async upsert(player, games, info) {
    let client; try { client = await getPool().connect(); await client.query("BEGIN");
      await client.query("INSERT INTO players(uid,nickname) VALUES($1,$2) ON CONFLICT(uid) DO UPDATE SET nickname=EXCLUDED.nickname,last_seen_at=now()", [player.uid, player.nickname]);
      if (games.some(game => game.uid !== player.uid)) throw dbError();
      for (const game of deduplicate(games)) await client.query(
        "INSERT INTO player_games(uid,game_id,started_at,character_code,matching_mode,game_rank,kills,assists,deaths,damage_to_player,play_time_seconds,timestamp_policy) " +
        "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(uid,game_id) DO UPDATE SET " +
        "matching_mode=COALESCE(EXCLUDED.matching_mode,player_games.matching_mode),game_rank=COALESCE(EXCLUDED.game_rank,player_games.game_rank)," +
        "kills=COALESCE(EXCLUDED.kills,player_games.kills),assists=COALESCE(EXCLUDED.assists,player_games.assists),deaths=COALESCE(EXCLUDED.deaths,player_games.deaths)," +
        "damage_to_player=COALESCE(EXCLUDED.damage_to_player,player_games.damage_to_player),play_time_seconds=COALESCE(EXCLUDED.play_time_seconds,player_games.play_time_seconds),ingested_at=now() " +
        "WHERE player_games.started_at=EXCLUDED.started_at AND player_games.character_code=EXCLUDED.character_code " +
        "AND (player_games.matching_mode IS NULL OR EXCLUDED.matching_mode IS NULL OR player_games.matching_mode=EXCLUDED.matching_mode)",
        [game.uid,game.gameId,game.startedAt,game.characterCode,game.matchingMode,game.rank,game.kills,game.assists,game.deaths,game.damage,game.duration,game.timestampPolicy ?? "unknown"]);
      await client.query("INSERT INTO sync_runs(uid,finished_at,status,record_count,dropped_records,completeness,timestamp_policy) VALUES($1,now(),'success',$2,$3,'partial',$4)", [player.uid,games.length,info.droppedRecords,info.timestampPolicy]);
      await client.query("DELETE FROM sync_runs WHERE uid=$1 AND finished_at < now() - interval '30 days' AND id <> (SELECT id FROM sync_runs WHERE uid=$1 AND status='success' ORDER BY finished_at DESC,id DESC LIMIT 1)", [player.uid]);
      await client.query("COMMIT");
    } catch { if (client) await client.query("ROLLBACK").catch(() => {}); throw dbError(); } finally { client?.release(); }
  },
};

export function repository(): Repository { return process.env.DATABASE_URL ? postgres : memory; }

export async function closeRepository(): Promise<void> { const current = pool; pool = null; if (current) await current.end(); }
