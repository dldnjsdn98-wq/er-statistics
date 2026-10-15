import { describe, expect, it } from "vitest";
import { buildStats, filterGames, kstBounds, parseQuery, summarize } from "./domain";
import type { PlayerGame, Query, StatsResponse } from "./types";

const base: PlayerGame = { uid: "u1", gameId: "1", startedAt: "2026-09-30T15:00:00.000Z", characterCode: 1, matchingMode: 3, rank: 1, kills: 4, assists: 2, deaths: 1, damage: 1000, duration: 1000 };
const query: Query = { nickname: "test", startDate: "2026-10-01", endDate: "2026-10-01", characterCodes: [1, 2, 7], mode: "ranked", page: 1, pageSize: 2 };
const coverage: StatsResponse["coverage"] = { completeness: "demo", upstreamRetentionDays: null, observedFrom: null, observedTo: null, lastSyncedAt: null, stale: false, droppedRecords: 0, timestampPolicy: "demo", warnings: [] };

describe("KST calendar bounds and input", () => {
  it("includes the start midnight and excludes the next midnight", () => {
    expect(kstBounds("2026-10-01", "2026-10-01")).toEqual({ startInclusive: "2026-09-30T15:00:00.000Z", endExclusive: "2026-10-01T15:00:00.000Z" });
    const games = [base, { ...base, gameId: "2", startedAt: "2026-10-01T14:59:59.999Z" }, { ...base, gameId: "3", startedAt: "2026-10-01T15:00:00.000Z" }];
    expect(filterGames(games, query).map(game => game.gameId)).toEqual(["2", "1"]);
  });
  it("validates calendar days, leap years, ordering, and numeric limits", () => {
    expect(() => kstBounds("2024-02-29", "2024-02-29")).not.toThrow();
    for (const date of ["2026-02-30", "2025-02-29", "2026-13-01", "2026-00-01", "2026-10-32"]) expect(() => kstBounds(date, date)).toThrow();
    expect(() => kstBounds("2026-01-02", "2026-01-01")).toThrow();
    const params = new URLSearchParams({ nickname: " a ", startDate: "2026-10-01", endDate: "2026-10-01", characterCodes: "7,1,7,2" });
    expect(parseQuery(params).characterCodes).toEqual([1, 2, 7]);
    params.set("characterCodes", Array.from({ length: 101 }, (_, i) => String(i + 1)).join(","));
    expect(() => parseQuery(params)).toThrow();
    params.set("characterCodes", "1,abc"); expect(() => parseQuery(params)).toThrow();
    params.set("characterCodes", "1"); params.set("page", "0"); expect(() => parseQuery(params)).toThrow();
  });
});

describe("multi-character aggregation", () => {
  const games = [
    base,
    { ...base, gameId: "1", rank: 7 }, // duplicate does not replace first game
    { ...base, gameId: "2", characterCode: 2, rank: 3, kills: 2, damage: 3000 },
    { ...base, gameId: "3", characterCode: 3 },
    { ...base, gameId: "4", matchingMode: 2 },
    { ...base, gameId: "5", startedAt: "2026-10-02T15:00:00.000Z" },
  ];
  it("combines selected characters with OR and date/mode with AND; summary uses raw games", () => {
    const result = buildStats({ query, games, characters: [{ code: 1, name: "A" }, { code: 2, name: "B" }], source: "demo", storage: "fixture", player: { uid: "u1", nickname: "fixture" }, coverage });
    expect(result.summary).toMatchObject({ games: 2, wins: 1, winRate: 50, averageRank: 2, averageKills: 3, averageDamage: 2000 });
    expect(result.characters.map(row => [row.code, row.games])).toEqual([[1, 1], [2, 1], [7, 0]]);
    expect(result.characters[2]).toMatchObject({ name: "캐릭터 7", winRate: null, averageDamage: null });
    expect(result.pagination.total).toBe(2);
    expect(filterGames(games, { ...query, characterCodes: [], mode: "all" })).toHaveLength(4);
  });
  it("paginates only matches and handles empty data without fake zeros", () => {
    const result = buildStats({ query: { ...query, page: 9 }, games, characters: [], source: "demo", storage: "fixture", player: { uid: "u1", nickname: "fixture" }, coverage });
    expect(result.matches).toEqual([]);
    expect(result.summary.games).toBe(2);
    expect(result.pagination).toEqual({ page: 9, pageSize: 2, total: 2, totalPages: 1 });
    expect(result.trend).toEqual([{ date: "2026-10-01", games: 2, wins: 1, winRate: 50, averageRank: 2, rankSamples: 2 }]);
    expect(summarize([])).toMatchObject({ games: 0, wins: 0, winRate: null, averageRank: null, averageKills: null });
  });
  it("uses valid metric sample counts rather than treating missing values as zero", () => {
    expect(summarize([{ ...base, rank: null, damage: null, kills: null }, { ...base, gameId: "2", rank: 1, damage: 2500, kills: 3 }])).toMatchObject({ games: 2, wins: 1, winRate: 100, averageRank: 1, averageKills: 3, averageDamage: 2500, metricCounts: { rank: 1, kills: 1, damage: 1 } });
  });
});

describe("daily trends", () => {
  const input = { characters: [{ code: 1, name: "A" }, { code: 2, name: "B" }], source: "demo" as const, storage: "fixture" as const, player: { uid: "u1", nickname: "fixture" }, coverage };
  const trendQuery: Query = { ...query, startDate: "2026-10-01", endDate: "2026-10-04", characterCodes: [1, 2], mode: "ranked", pageSize: 1 };
  const games: PlayerGame[] = [
    { ...base, gameId: "before", startedAt: "2026-09-30T14:59:59.999Z" },
    { ...base, gameId: "a", startedAt: "2026-09-30T15:00:00.000Z", rank: 1 },
    { ...base, gameId: "a", startedAt: "2026-09-30T15:00:00.000Z", rank: 9 },
    { ...base, gameId: "b", startedAt: "2026-10-01T14:59:59.999Z", characterCode: 2, rank: 3 },
    { ...base, gameId: "normal", startedAt: "2026-10-01T15:00:00.000Z", matchingMode: 2 },
    { ...base, gameId: "other", startedAt: "2026-10-02T15:00:00.000Z", characterCode: 3 },
    { ...base, gameId: "c", startedAt: "2026-10-02T15:00:00.000Z", characterCode: 2, rank: null },
  ];
  it("buckets by KST, honors deduplication and all filters, and leaves empty days sparse", () => {
    const result = buildStats({ ...input, query: trendQuery, games });
    expect(result.trend).toEqual([
      { date: "2026-10-01", games: 2, wins: 1, winRate: 50, averageRank: 2, rankSamples: 2 },
      { date: "2026-10-03", games: 1, wins: 0, winRate: null, averageRank: null, rankSamples: 0 },
    ]);
    expect(result.summary).toMatchObject({ games: 3, wins: 1, winRate: 50, metricCounts: { rank: 2 } });
    expect(result.matches).toHaveLength(1);
  });
  it("keeps trends unchanged across match pages and returns no false zero for empty results", () => {
    const first = buildStats({ ...input, query: trendQuery, games });
    const later = buildStats({ ...input, query: { ...trendQuery, page: 3 }, games });
    expect(later.trend).toEqual(first.trend);
    expect(later.matches).not.toEqual(first.matches);
    const empty = buildStats({ ...input, query: { ...trendQuery, characterCodes: [7] }, games });
    expect(empty.trend).toEqual([]);
    expect(empty.characters).toMatchObject([{ code: 7, games: 0, winRate: null }]);
  });
  it("handles a wide allowed date range with only observed days", () => {
    const result = buildStats({ ...input, query: { ...trendQuery, startDate: "1000-01-01", endDate: "9999-12-31" }, games });
    expect(result.trend.map(day => day.date)).toEqual(["2026-09-30", "2026-10-01", "2026-10-03"]);
  });
});
