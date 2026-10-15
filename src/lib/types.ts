export type MatchMode = "all" | "normal" | "ranked";
export type GameMode = Exclude<MatchMode, "all"> | "unknown";
export type Source = "demo" | "live";
export type TimestampPolicy = "explicit-offset" | "assumed-Asia/Seoul" | "assumed-UTC" | "unknown" | "demo";
export interface Character { code: number; name: string }
export interface Query { nickname: string; startDate: string; endDate: string; characterCodes: number[]; mode: MatchMode; page: number; pageSize: number }
export interface MetricSummary { games: number; wins: number; winRate: number | null; averageRank: number | null; averageKills: number | null; averageAssists: number | null; averageDamage: number | null; metricCounts: { rank: number; kills: number; assists: number; damage: number } }
export interface DailyTrendPoint { date: string; games: number; wins: number; winRate: number | null; averageRank: number | null; rankSamples: number }
export interface Match { gameId: string; startedAt: string; characterCode: number; characterName: string; mode: GameMode; rank: number | null; kills: number | null; assists: number | null; damage: number | null }
export interface StatsResponse {
  source: Source; storage: "fixture" | "memory" | "postgres";
  player: { uid: string; nickname: string };
  filters: { startDate: string; endDate: string; timeZone: "Asia/Seoul"; startInclusive: string; endExclusive: string; characterCodes: number[]; mode: MatchMode };
  coverage: { completeness: "demo" | "partial" | "complete"; upstreamRetentionDays: 90 | null; observedFrom: string | null; observedTo: string | null; lastSyncedAt: string | null; stale: boolean; droppedRecords: number; timestampPolicy: TimestampPolicy; timestampPolicies?: TimestampPolicy[]; retryAfterSeconds?: number | null; retryAt?: string | null; metadataStatus?: MetadataStatus; warnings: Array<{ code: string; message: string }> };
  summary: MetricSummary; trend: DailyTrendPoint[]; characters: Array<MetricSummary & Character>; matches: Match[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}
export interface PlayerGame { timestampPolicy?: TimestampPolicy; uid: string; gameId: string; startedAt: string; characterCode: number; matchingMode: number | null; rank: number | null; kills: number | null; assists: number | null; deaths: number | null; damage: number | null; duration: number | null }

export type MetadataStatus = "fresh" | "stale" | "unavailable";
export interface CharactersResponse { source: Source; characters: Character[]; status: MetadataStatus; lastUpdatedAt: string | null; retryAfterSeconds: number | null }
