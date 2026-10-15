import { describe, expect, it } from "vitest";
import { sortCharacterRows } from "./character-sort";
import type { StatsResponse } from "./types";

const row = (code: number, games: number, winRate: number | null, averageRank: number | null): StatsResponse["characters"][number] => ({
  code, name: `C${code}`, games, wins: 0, winRate, averageRank,
  averageKills: null, averageAssists: null, averageDamage: null,
  metricCounts: { rank: 0, kills: 0, assists: 0, damage: 0 },
});

describe("character comparison sorting", () => {
  const rows = [row(7, 0, null, null), row(2, 4, 50, 3), row(1, 4, 50, 1), row(3, 2, 100, 2)];
  it("puts missing metrics last in both directions and breaks ties by code", () => {
    expect(sortCharacterRows(rows, "winRate", "desc").map(item => item.code)).toEqual([3, 1, 2, 7]);
    expect(sortCharacterRows(rows, "winRate", "asc").map(item => item.code)).toEqual([1, 2, 3, 7]);
    expect(sortCharacterRows(rows, "averageRank", "asc").map(item => item.code)).toEqual([1, 3, 2, 7]);
    expect(sortCharacterRows(rows, "games", "desc").map(item => item.code)).toEqual([1, 2, 3, 7]);
    expect(rows.map(item => item.code)).toEqual([7, 2, 1, 3]);
  });
});
