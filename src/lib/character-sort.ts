import type { StatsResponse } from "./types";

export type CharacterSortKey = "games" | "winRate" | "averageRank" | "averageKills" | "averageAssists" | "averageDamage";
export type SortDirection = "asc" | "desc";
type Row = StatsResponse["characters"][number];

export function sortCharacterRows(rows: Row[], key: CharacterSortKey, direction: SortDirection): Row[] {
  return [...rows].sort((a, b) => {
    const left = a[key], right = b[key];
    if (left === null) return right === null ? a.code - b.code : 1;
    if (right === null) return -1;
    const difference = direction === "asc" ? left - right : right - left;
    return difference || a.code - b.code;
  });
}
