import type { Character, PlayerGame, StatsResponse } from "./types";

export const DEMO_PLAYER = { uid: "demo-player", nickname: "데모플레이어" };
export const DEMO_CHARACTERS: Character[] = [
  { code: 1, name: "재키" }, { code: 2, name: "아야" }, { code: 3, name: "피오라" },
  { code: 4, name: "매그너스" }, { code: 5, name: "자히르" }, { code: 6, name: "나딘" },
  { code: 7, name: "현우" }, { code: 8, name: "하트" },
];

export function demoGames(now = new Date()): PlayerGame[] {
  const todayKst = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  const start = Date.parse(`${todayKst}T00:00:00Z`);
  return Array.from({ length: 64 }, (_, i) => {
    const dayOffset = i === 1 ? 0 : (i * 11 + Math.floor(i / 5) * 3) % 83;
    const utc = start - dayOffset * 86400000 - 9 * 3600000 + ((10 + i % 11) * 60 + i % 3 * 13) * 60000;
    return { uid: DEMO_PLAYER.uid, gameId: `demo-${String(i + 1).padStart(3, "0")}`, startedAt: new Date(utc).toISOString(), characterCode: [1, 2, 3, 4, 5, 7][i % 6], matchingMode: i % 3 === 0 ? 2 : 3, rank: [1, 2, 5, 7, 3, 4, 6, 1][i % 8], kills: (i * 7 + 3) % 13, assists: (i * 5 + 2) % 17, deaths: (i * 3) % 8, damage: 6400 + (i * 1973) % 27500, duration: 1000 + (i * 73) % 800 };
  });
}

export function demoCoverage(games: PlayerGame[]): StatsResponse["coverage"] {
  const timestamps = games.map(game => game.startedAt).sort();
  return { completeness: "demo", upstreamRetentionDays: null, observedFrom: timestamps.at(0) ?? null, observedTo: timestamps.at(-1) ?? null, lastSyncedAt: null, stale: false, droppedRecords: 0, timestampPolicy: "demo", warnings: [{ code: "DEMO_DATA", message: "고정 규칙으로 생성한 샘플 데이터입니다. 실제 플레이어 전적이 아닙니다." }] };
}
