import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { normalizeUserGames, parseOfficialTimestamp, resolvePlayer, fetchUserGames } from "./official";

beforeEach(() => { vi.stubEnv("ER_API_KEY", "test-secret"); vi.unstubAllGlobals(); });
describe("official API adapter", () => {
  it("accepts alphanumeric UID, encodes the nickname and maps documented fields", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: { uid: "eff12455D22Xj91", nickname: "한 글" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(resolvePlayer("한 글")).resolves.toEqual({ uid: "eff12455D22Xj91", nickname: "한 글" });
    expect(fetcher.mock.calls[0][0]).toContain("query=%ED%95%9C+%EA%B8%80");
    const normalized = normalizeUserGames({ userGames: [{ gameId: 9001, characterNum: 7, startDtm: "2026-10-01T00:00:00+09:00", matchingMode: 3, gameRank: 1, playerKill: 5, playerAssistant: 2, damageToPlayer: 4210, playTime: 1200 }] }, "eff12455D22Xj91", undefined);
    expect(normalized.games[0]).toMatchObject({ gameId: "9001", characterCode: 7, startedAt: "2026-09-30T15:00:00.000Z", matchingMode: 3, kills: 5, assists: 2, damage: 4210 });
  });
  it("requires configured timezone for zone-less times and rejects invalid calendar dates", () => {
    expect(() => parseOfficialTimestamp("2026-10-01 00:00:00", undefined)).toThrow();
    expect(parseOfficialTimestamp("2026-10-01 00:00:00", "Asia/Seoul")).toEqual({ iso: "2026-09-30T15:00:00.000Z", policy: "assumed-Asia/Seoul" });
    expect(() => parseOfficialTimestamp("2026-02-30T01:00:00Z", undefined)).toThrow();
    expect(() => parseOfficialTimestamp("2026-02-30 01:00:00", "UTC")).toThrow();
  });
  it("drops malformed rows but preserves unknown modes, nullable metrics and large string game IDs", () => {
    const normalized = normalizeUserGames({ userGames: [{ gameId: "9007199254740999999999", characterNum: 2, startDtm: "2026-10-01T02:00:00Z", matchingMode: 99 }, { gameId: 2, characterNum: null, startDtm: "bad" }] }, "u-1", undefined);
    expect(normalized).toMatchObject({ dropped: 1, timestampPolicy: "explicit-offset", games: [{ gameId: "9007199254740999999999", matchingMode: 99, rank: null, damage: null }] });
    expect(() => normalizeUserGames({ userGames: [], code: 500 }, "u", undefined)).toThrow();
    expect(() => normalizeUserGames({ broken: [] }, "u", undefined)).toThrow();
  });
  it.each([[404, "PLAYER_NOT_FOUND"], [429, "RATE_LIMITED"], [500, "UPSTREAM_UNAVAILABLE"]])("maps HTTP %i to %s without leaking the API key", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret body", { status, headers: status === 429 ? { "retry-after": "3" } : {} })));
    await expect(fetchUserGames("abc", undefined)).rejects.toMatchObject({ code });
  });
  it("reports network timeout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError")));
    await expect(fetchUserGames("abc", undefined)).rejects.toMatchObject({ code: "UPSTREAM_TIMEOUT" });
  });
});
