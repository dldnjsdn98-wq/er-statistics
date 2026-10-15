import { describe, expect, it } from "vitest";
import { groupDailyTrend } from "./trend-groups";
import type { DailyTrendPoint } from "./types";

const day = (date: string, games: number, wins: number, averageRank: number | null, rankSamples: number): DailyTrendPoint => ({
  date, games, wins, averageRank, rankSamples, winRate: rankSamples ? wins / rankSamples * 100 : null,
});

describe("calendar trend display groups", () => {
  it("uses rank samples to weight average rank and win rate", () => {
    const groups = groupDailyTrend([
      day("2026-01-01", 1, 1, 1, 1),
      day("2026-01-02", 9, 0, 5, 9),
    ], "2026-01-01", "2026-01-14");
    expect(groups).toHaveLength(7);
    expect(groups[0]).toMatchObject({ label: "1~2일차", startDate: "2026-01-01", endDate: "2026-01-02", games: 10, wins: 1, rankSamples: 10, winRate: 10, averageRank: 4.6 });
  });
  it("covers remainder days exactly and leaves empty or unranked groups null", () => {
    const groups = groupDailyTrend([
      day("2026-01-05", 2, 0, null, 0),
      day("2025-12-31", 99, 99, 1, 99),
      day("2026-01-16", 99, 99, 1, 99),
    ], "2026-01-01", "2026-01-15");
    expect(groups.map(group => [group.startDay, group.endDay])).toEqual([[1, 3], [4, 5], [6, 7], [8, 9], [10, 11], [12, 13], [14, 15]]);
    expect(groups[0]).toMatchObject({ games: 0, wins: 0, rankSamples: 0, winRate: null, averageRank: null });
    expect(groups[1]).toMatchObject({ games: 2, rankSamples: 0, winRate: null, averageRank: null });
    expect(groups[6].endDate).toBe("2026-01-15");
  });
  it("uses one group per selected day for short ranges, including one day", () => {
    expect(groupDailyTrend([], "2026-10-01", "2026-10-03").map(group => group.label)).toEqual(["1일차", "2일차", "3일차"]);
    expect(groupDailyTrend([day("2026-10-01", 1, 1, 1, 1)], "2026-10-01", "2026-10-01")).toMatchObject([{ label: "1일차", games: 1, averageRank: 1 }]);
  });
  it("keeps an extreme allowed range to seven groups without day-by-day expansion", () => {
    const groups = groupDailyTrend([day("2026-10-01", 1, 1, 1, 1)], "1000-01-01", "9999-12-31");
    expect(groups).toHaveLength(7);
    expect(groups[0].startDate).toBe("1000-01-01");
    expect(groups[6].endDate).toBe("9999-12-31");
    expect(groups.reduce((sum, group) => sum + group.games, 0)).toBe(1);
    expect(groups.map(group => group.tickLabel)).toEqual(["1구간", "2구간", "3구간", "4구간", "5구간", "6구간", "7구간"]);
  });
});
