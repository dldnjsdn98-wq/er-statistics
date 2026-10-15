import { dateMs } from "./domain";
import type { DailyTrendPoint } from "./types";

const dayLength = 86400000;

export interface TrendGroup {
  index: number;
  label: string;
  tickLabel: string;
  startDay: number;
  endDay: number;
  startDate: string;
  endDate: string;
  games: number;
  wins: number;
  rankSamples: number;
  winRate: number | null;
  averageRank: number | null;
}

export function groupDailyTrend(trend: DailyTrendPoint[], startDate: string, endDate: string): TrendGroup[] {
  const start = dateMs(startDate), end = dateMs(endDate);
  if (end < start) return [];
  const totalDays = Math.floor((end - start) / dayLength) + 1;
  const count = Math.min(7, totalDays);
  const baseSize = Math.floor(totalDays / count), remainder = totalDays % count;
  const groups: TrendGroup[] = [];
  let startDay = 1;
  for (let index = 0; index < count; index++) {
    const endDay = startDay + baseSize + (index < remainder ? 1 : 0) - 1;
    const dateAt = (day: number) => new Date(start + (day - 1) * dayLength).toISOString().slice(0, 10);
    groups.push({
      index,
      label: startDay === endDay ? `${startDay}일차` : `${startDay}~${endDay}일차`,
      tickLabel: totalDays > 150 ? `${index + 1}구간` : startDay === endDay ? `${startDay}일차` : `${startDay}~${endDay}`,
      startDay, endDay, startDate: dateAt(startDay), endDate: dateAt(endDay),
      games: 0, wins: 0, rankSamples: 0, winRate: null, averageRank: null,
    });
    startDay = endDay + 1;
  }

  const weightedRanks = Array<number>(count).fill(0);
  for (const day of trend) {
    const offset = Math.floor((dateMs(day.date) - start) / dayLength) + 1;
    const group = groups.find(item => item.startDay <= offset && offset <= item.endDay);
    if (!group) continue;
    group.games += day.games;
    group.wins += day.wins;
    if (Number.isSafeInteger(day.rankSamples) && day.rankSamples > 0 && day.averageRank !== null && Number.isFinite(day.averageRank)) {
      group.rankSamples += day.rankSamples;
      weightedRanks[group.index] += day.averageRank * day.rankSamples;
    }
  }
  for (const group of groups) {
    if (group.rankSamples) {
      group.winRate = group.wins / group.rankSamples * 100;
      group.averageRank = weightedRanks[group.index] / group.rankSamples;
    }
  }
  return groups;
}
