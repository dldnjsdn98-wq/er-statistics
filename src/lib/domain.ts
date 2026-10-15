import type { Character, DailyTrendPoint, MatchMode, MetricSummary, PlayerGame, Query, StatsResponse } from "./types";
export class QueryError extends Error { constructor(message: string, public fields: Record<string, string> = {}) { super(message); } }
export function dateMs(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new QueryError("날짜는 YYYY-MM-DD 형식이어야 합니다.");
  const [year, month, day] = date.split("-").map(Number);
  const ms = Date.UTC(year, month - 1, day); const checked = new Date(ms);
  if (year < 1000 || checked.getUTCFullYear() !== year || checked.getUTCMonth() + 1 !== month || checked.getUTCDate() !== day) throw new QueryError("실재하는 날짜를 입력해 주세요.");
  return ms;
}
export function kstBounds(startDate: string, endDate: string): { startInclusive: string; endExclusive: string } {
  const start = dateMs(startDate), end = dateMs(endDate);
  if (start > end) throw new QueryError("시작일은 종료일보다 늦을 수 없습니다.", { startDate: "종료일 이전 날짜를 선택해 주세요." });
  return { startInclusive: new Date(start - 9 * 3600000).toISOString(), endExclusive: new Date(end + 86400000 - 9 * 3600000).toISOString() };
}
function integerParam(raw: string | null, fallback: number, max: number, name: string): number {
  if (raw === null) return fallback;
  if (!/^[1-9]\d*$/.test(raw) || raw.length > 9 || Number(raw) > max) throw new QueryError(`${name} 값이 올바르지 않습니다.`);
  return Number(raw);
}
export function parseQuery(params: URLSearchParams): Query {
  if (params.toString().length > 2048) throw new QueryError("검색 조건이 너무 깁니다.");
  for (const key of ["nickname", "startDate", "endDate", "characterCodes", "mode", "page", "pageSize"]) if (params.getAll(key).length > 1) throw new QueryError(`중복된 ${key} 조건이 있습니다.`);
  const nickname = (params.get("nickname") ?? "").trim();
  if (!nickname || nickname.length > 64) throw new QueryError("닉네임을 1~64자로 입력해 주세요.");
  const startDate = params.get("startDate") ?? "", endDate = params.get("endDate") ?? ""; kstBounds(startDate, endDate);
  const mode = params.get("mode") ?? "all";
  if (!["all", "normal", "ranked"].includes(mode)) throw new QueryError("게임 모드가 올바르지 않습니다.");
  const rawCodes = params.get("characterCodes") ?? "", codeStrings = rawCodes === "" ? [] : rawCodes.split(",");
  if (codeStrings.length > 100 || codeStrings.some(code => !/^[1-9]\d*$/.test(code) || code.length > 9)) throw new QueryError("실험체 코드는 100개 이하의 양의 정수여야 합니다.");
  return { nickname, startDate, endDate, mode: mode as MatchMode, characterCodes: [...new Set(codeStrings.map(Number))].sort((a, b) => a - b), page: integerParam(params.get("page"), 1, 100000000, "page"), pageSize: integerParam(params.get("pageSize"), 20, 100, "pageSize") };
}
export function modeOf(game: PlayerGame): "normal" | "ranked" | "unknown" { return game.matchingMode === 2 ? "normal" : game.matchingMode === 3 ? "ranked" : "unknown"; }
// Merge missing measurements only when both rows describe the same observation.
// Conflicting time/character identities keep the first row; never mix two matches.
export function mergeDuplicate(first: PlayerGame, later: PlayerGame): PlayerGame {
  if (first.uid !== later.uid || first.gameId !== later.gameId || first.startedAt !== later.startedAt || first.characterCode !== later.characterCode ||
      (first.matchingMode !== null && later.matchingMode !== null && first.matchingMode !== later.matchingMode)) return { ...first };
  const merged = { ...first };
  for (const key of ["matchingMode", "rank", "kills", "assists", "deaths", "damage", "duration"] as const) {
    if (merged[key] === null && later[key] !== null && Number.isFinite(later[key]) && later[key]! >= 0) merged[key] = later[key];
  }
  return merged;
}
export function deduplicate(games: PlayerGame[]): PlayerGame[] {
  const found = new Map<string, PlayerGame>();
  for (const game of games) {
    const key = game.uid + "\u0000" + game.gameId, first = found.get(key);
    found.set(key, first ? mergeDuplicate(first, game) : { ...game });
  }
  return [...found.values()];
}

export function filterGames(games: PlayerGame[], query: Query): PlayerGame[] {
  const { startInclusive, endExclusive } = kstBounds(query.startDate, query.endDate), start = Date.parse(startInclusive), end = Date.parse(endExclusive), selected = new Set(query.characterCodes);
  return deduplicate(games).filter(game => { const time = Date.parse(game.startedAt); return Number.isFinite(time) && time >= start && time < end && (query.mode === "all" || modeOf(game) === query.mode) && (!selected.size || selected.has(game.characterCode)); }).sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.gameId.localeCompare(a.gameId));
}
function valid(n: number | null): n is number { return n !== null && Number.isFinite(n) && n >= 0; }
function average(values: Array<number | null>): [number | null, number] { const found = values.filter(valid); return [found.length ? found.reduce((sum, value) => sum + value, 0) / found.length : null, found.length]; }
export function summarize(games: PlayerGame[]): MetricSummary {
  const ranks = games.map(game => game.rank !== null && Number.isInteger(game.rank) && game.rank >= 1 ? game.rank : null);
  const [averageRank, rankCount] = average(ranks), [averageKills, killsCount] = average(games.map(game => game.kills)), [averageAssists, assistsCount] = average(games.map(game => game.assists)), [averageDamage, damageCount] = average(games.map(game => game.damage));
  const wins = ranks.filter(value => value === 1).length;
  return { games: games.length, wins, winRate: rankCount ? wins / rankCount * 100 : null, averageRank, averageKills, averageAssists, averageDamage, metricCounts: { rank: rankCount, kills: killsCount, assists: assistsCount, damage: damageCount } };
}
export function dailyTrend(games: PlayerGame[]): DailyTrendPoint[] {
  const days = new Map<string, PlayerGame[]>();
  for (const game of games) {
    const date = new Date(Date.parse(game.startedAt) + 9 * 3600000).toISOString().slice(0, 10);
    const day = days.get(date) ?? [];
    day.push(game);
    days.set(date, day);
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, day]) => {
    const { games, wins, winRate, averageRank, metricCounts } = summarize(day);
    return { date, games, wins, winRate, averageRank, rankSamples: metricCounts.rank };
  });
}
export function buildStats(input: { query: Query; games: PlayerGame[]; characters: Character[]; source: "demo" | "live"; storage: "fixture" | "memory" | "postgres"; player: { uid: string; nickname: string }; coverage: StatsResponse["coverage"] }): StatsResponse {
  const { query, games, characters, source, storage, player, coverage } = input, chosen = filterGames(games, query), names = new Map(characters.map(character => [character.code, character.name]));
  const codes = query.characterCodes.length ? query.characterCodes : [...new Set(chosen.map(game => game.characterCode))];
  const characterRows = codes.map(code => ({ code, name: names.get(code) ?? `캐릭터 ${code}`, ...summarize(chosen.filter(game => game.characterCode === code)) })).sort((a, b) => b.games - a.games || a.code - b.code);
  const start = (query.page - 1) * query.pageSize;
  const matches = chosen.slice(start, start + query.pageSize).map(game => ({ gameId: game.gameId, startedAt: game.startedAt, characterCode: game.characterCode, characterName: names.get(game.characterCode) ?? `캐릭터 ${game.characterCode}`, mode: modeOf(game), rank: game.rank, kills: game.kills, assists: game.assists, damage: game.damage }));
  return { source, storage, player, filters: { startDate: query.startDate, endDate: query.endDate, timeZone: "Asia/Seoul", ...kstBounds(query.startDate, query.endDate), characterCodes: query.characterCodes, mode: query.mode }, coverage, summary: summarize(chosen), trend: dailyTrend(chosen), characters: characterRows, matches, pagination: { page: query.page, pageSize: query.pageSize, total: chosen.length, totalPages: Math.ceil(chosen.length / query.pageSize) } };
}
