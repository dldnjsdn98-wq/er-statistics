import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./official", () => ({ resolvePlayer: vi.fn(), fetchUserGames: vi.fn(), fetchCharacters: vi.fn() }));
vi.mock("./repository", async importOriginal => {
  const actual = await importOriginal<typeof import("./repository")>();
  return { ...actual, repository: vi.fn() };
});
import type { PlayerGame, Query } from "../types";

const query: Query = { nickname: "fixture", startDate: "2026-10-01", endDate: "2026-10-15", characterCodes: [], mode: "all", page: 1, pageSize: 20 };
const player = { uid: "u1", nickname: "fixture" };
const game: PlayerGame = { ...player, gameId: "1", startedAt: "2026-10-02T00:00:00.000Z", characterCode: 7, matchingMode: 3, rank: 1, kills: 2, assists: 1, deaths: 0, damage: 100, duration: 900, timestampPolicy: "assumed-Asia/Seoul" };
async function setup() {
  const official = await import("./official");
  const repositories = await import("./repository");
  const { AppError } = await import("./errors");
  const repo = repositories.createMemoryRepository();
  vi.mocked(repositories.repository).mockReturnValue(repo);
  vi.mocked(official.resolvePlayer).mockResolvedValue(player);
  vi.mocked(official.fetchUserGames).mockResolvedValue({ games: [game], dropped: 0, timestampPolicy: "assumed-Asia/Seoul" });
  vi.mocked(official.fetchCharacters).mockResolvedValue([{ code: 7, name: "fixture character" }]);
  const service = await import("./service");
  return { official, repo, AppError, ...service };
}
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-15T00:00:00Z"));
  vi.stubEnv("ER_DATA_SOURCE", "live"); vi.stubEnv("ER_API_KEY", "fixture-only"); vi.stubEnv("DATABASE_URL", "");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network call"); }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("live service recovery", () => {
  it("coalesces nickname, game and metadata requests during concurrent reads", async () => {
    const s = await setup();
    const results = await Promise.all([s.getStats(query), s.getStats(query), s.getCharacters()]);
    expect(results[0]).toMatchObject({ summary: { games: 1 }, coverage: { stale: false, metadataStatus: "fresh" } });
    expect(s.official.resolvePlayer).toHaveBeenCalledTimes(1);
    expect(s.official.fetchUserGames).toHaveBeenCalledTimes(1);
    expect(s.official.fetchCharacters).toHaveBeenCalledTimes(1);
  });
  it("never returns zero games as success when only UID resolution succeeded", async () => {
    const s = await setup();
    vi.mocked(s.official.fetchUserGames).mockRejectedValue(new s.AppError("UPSTREAM_TIMEOUT", 504, "fixture"));
    await expect(s.getStats(query)).rejects.toMatchObject({ code: "UPSTREAM_TIMEOUT" });
    vi.setSystemTime(new Date("2026-10-15T00:02:00Z"));
    vi.mocked(s.official.resolvePlayer).mockRejectedValue(new s.AppError("UPSTREAM_UNAVAILABLE", 502, "fixture"));
    await expect(s.getStats(query)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });
  it("allows a previously successful empty history as an explicit stale result", async () => {
    const s = await setup();
    vi.mocked(s.official.fetchUserGames).mockResolvedValue({ games: [], dropped: 0, timestampPolicy: "explicit-offset" });
    expect(await s.getStats(query)).toMatchObject({ summary: { games: 0 }, coverage: { stale: false } });
    vi.setSystemTime(new Date("2026-10-15T00:02:00Z"));
    vi.mocked(s.official.fetchUserGames).mockRejectedValue(new s.AppError("RATE_LIMITED", 429, "fixture", 120));
    expect(await s.getStats(query)).toMatchObject({ summary: { games: 0 }, coverage: { stale: true, retryAfterSeconds: 120, retryAt: "2026-10-15T00:04:00.000Z" } });
  });
  it("keeps assumed timestamp provenance through an empty subsequent sync", async () => {
    const s = await setup();
    await s.getStats(query);
    vi.setSystemTime(new Date("2026-10-15T00:02:00Z"));
    vi.mocked(s.official.fetchUserGames).mockResolvedValue({ games: [], dropped: 0, timestampPolicy: "explicit-offset" });
    const result = await s.getStats(query);
    expect(result.summary.games).toBe(1);
    expect(result.coverage.timestampPolicies).toEqual(["assumed-Asia/Seoul"]);
    expect(result.coverage.warnings.some(warning => warning.message.includes("한국 시간"))).toBe(true);
  });
  it("does not reuse an old identity for unresolved or forbidden nicknames", async () => {
    const s = await setup();
    await s.getStats(query);
    vi.setSystemTime(new Date("2026-10-15T00:02:00Z"));
    vi.mocked(s.official.resolvePlayer).mockRejectedValue(new s.AppError("UPSTREAM_NOT_FOUND", 404, "fixture"));
    await expect(s.getStats(query)).rejects.toMatchObject({ code: "UPSTREAM_NOT_FOUND" });
    expect(s.official.fetchUserGames).toHaveBeenCalledTimes(1);
  });
  it("marks metadata failure and backs off instead of treating it as a fresh empty list", async () => {
    const s = await setup();
    vi.mocked(s.official.fetchCharacters).mockRejectedValue(new s.AppError("UPSTREAM_UNAVAILABLE", 502, "fixture"));
    expect(await s.getCharacters()).toMatchObject({ status: "unavailable", retryAfterSeconds: 15 });
    expect(await s.getCharacters()).toMatchObject({ status: "unavailable" });
    const stats = await s.getStats(query);
    expect(stats.coverage.metadataStatus).toBe("unavailable");
    expect(s.official.fetchCharacters).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-15T00:00:16Z"));
    vi.mocked(s.official.fetchCharacters).mockResolvedValue([{ code: 7, name: "restored" }]);
    expect(await s.getCharacters()).toMatchObject({ status: "fresh", characters: [{ name: "restored" }] });
  });
  it("retains stale metadata with an explicit warning when refresh fails", async () => {
    const s = await setup();
    await s.getCharacters();
    vi.setSystemTime(new Date("2026-10-16T00:00:01Z"));
    vi.mocked(s.official.fetchCharacters).mockRejectedValue(new s.AppError("UPSTREAM_TIMEOUT", 504, "fixture"));
    expect(await s.getCharacters()).toMatchObject({ status: "stale", characters: [{ code: 7 }] });
  });
});
