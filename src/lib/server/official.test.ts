import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/domain", async () => import("../domain"));
vi.mock("@/lib/server/errors", async () => import("./errors"));
vi.mock("@/lib/server/service", async () => import("./service"));
import observedLookup from "./fixtures/nickname-lookup-2026-10-15.json";
import { normalizeUserGames, parseOfficialTimestamp, resolvePlayer, fetchUserGames } from "./official";
import { GET } from "../../app/api/stats/route";

let testTime = 2_000_000_000_000;
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.stubEnv("ER_API_KEY", "test-secret");
  vi.stubEnv("ER_DATA_SOURCE", "LIVE");
  vi.stubEnv("DATABASE_URL", "");
  testTime += 24 * 60 * 60 * 1000;
  vi.spyOn(Date, "now").mockImplementation(() => (testTime += 1001));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function statsRequest(nickname: string): Request {
  const query = new URLSearchParams({ nickname, startDate: "2026-10-01", endDate: "2026-10-15", characterCodes: "7" });
  return new Request(`http://localhost/api/stats?${query}`);
}
function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("official API adapter", () => {
  it("accepts alphanumeric UID, encodes the nickname and maps documented fields", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ user: { uid: "eff12455D22Xj91", nickname: "한 글" } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(resolvePlayer("한 글")).resolves.toEqual({ uid: "eff12455D22Xj91", nickname: "한 글" });
    expect(fetcher.mock.calls[0][0]).toBe("https://open-api.bser.io/v1/user/nickname?query=%ED%95%9C+%EA%B8%80");
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
  it("replays the reconstructed lookup response as a neutral upstream 404", async () => {
    expect(observedLookup.provenance).toContain("not a raw HTTP capture");
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(observedLookup.response.body, observedLookup.response.status));
    vi.stubGlobal("fetch", fetcher);
    const response = await GET(statsRequest("toprain"));
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([observedLookup.request.url]);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "UPSTREAM_NOT_FOUND" } });
  });
  it.each([
    [404, "UPSTREAM_NOT_FOUND", 404],
    [403, "UPSTREAM_FORBIDDEN", 502],
    [401, "UPSTREAM_AUTH_FAILED", 502],
    [429, "RATE_LIMITED", 429],
    [500, "UPSTREAM_UNAVAILABLE", 502],
  ])("maps HTTP %i to %s without claiming a missing player", async (status, code, appStatus) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("provider text must stay private", { status, headers: status === 429 ? { "retry-after": "9999" } : {} }));
    vi.stubGlobal("fetch", fetcher);
    const response = await GET(statsRequest(`http-case-${status}`));
    expect(response.status).toBe(appStatus);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code } });
    expect(JSON.stringify(body)).not.toContain("provider text");
    expect(JSON.stringify(body)).not.toContain("test-secret");
    if (status === 429) { expect(response.headers.get("retry-after")).toBe("9999"); expect(body.error.retryAfterSeconds).toBe(9999); }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    [404, "UPSTREAM_NOT_FOUND", 404, null],
    [403, "UPSTREAM_FORBIDDEN", 502, null],
    [401, "UPSTREAM_AUTH_FAILED", 502, null],
    [429, "RATE_LIMITED", 429, "3"],
    [429, "RATE_LIMITED", 429, null],
    [500, "UPSTREAM_UNAVAILABLE", 502, null],
  ])("maps HTTP 200 provider code %i to %s (retry-after %s)", async (providerCode, code, status, retryHeader) => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ code: providerCode, message: "provider detail must stay private" }, 200, retryHeader ? { "retry-after": retryHeader } : {}));
    vi.stubGlobal("fetch", fetcher);
    const response = await GET(statsRequest(`body-case-${providerCode}`));
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code } });
    expect(JSON.stringify(body)).not.toContain("provider detail");
    expect(JSON.stringify(body)).not.toContain("test-secret");
    if (providerCode === 429) { const seconds = retryHeader ? 3 : 60; expect(response.headers.get("retry-after")).toBe(String(seconds)); expect(body.error.retryAfterSeconds).toBe(seconds); }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["missing user", { code: 200 }],
    ["missing UID", { code: 200, user: { nickname: "bad" } }],
    ["unsafe UID", { code: 200, user: { uid: "bad/uid", nickname: "bad" } }],
    ["missing nickname", { code: 200, user: { uid: "safe" } }],
    ["nonnumeric code", { code: "404", message: "Not Found" }],
    ["contradictory error", { code: 200, error: { message: "private" }, user: { uid: "safe", nickname: "bad" } }],
    ["null", null],
    ["array", []],
  ])("rejects %s as an invalid provider response", async (label, providerBody) => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(providerBody));
    vi.stubGlobal("fetch", fetcher);
    const response = await GET(statsRequest(`invalid-${label}`));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "UPSTREAM_INVALID_RESPONSE" } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed JSON as an invalid provider response", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const response = await GET(statsRequest("broken-json"));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "UPSTREAM_INVALID_RESPONSE" } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("follows an encoded nickname through UID and games without substituting demo data", async () => {
    const nickname = "한 글 &";
    const uid = "eff12455D22Xj91";
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ code: 200, user: { uid, nickname } }))
      .mockResolvedValueOnce(jsonResponse({ code: 200, userGames: [{ gameId: 9001, characterNum: 7, startDtm: "2026-10-10T12:00:00+09:00", matchingMode: 3, gameRank: 1, playerKill: 5 }] }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ code: 7, name: "캐릭터 7" }] }));
    vi.stubGlobal("fetch", fetcher);
    const response = await GET(statsRequest(nickname));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ source: "live", player: { uid, nickname }, summary: { games: 1, wins: 1 } });
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      "https://open-api.bser.io/v1/user/nickname?query=%ED%95%9C+%EA%B8%80+%26",
      `https://open-api.bser.io/v1/user/games/uid/${uid}`,
      "https://open-api.bser.io/v2/data/Character",
    ]);
  });
  it("normalizes provider codes on the games endpoint too", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ code: 403, message: "private" })));
    await expect(fetchUserGames("safe", undefined)).rejects.toMatchObject({ code: "UPSTREAM_FORBIDDEN", status: 502 });
  });
  it("reports network timeout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError")));
    await expect(fetchUserGames("abc", undefined)).rejects.toMatchObject({ code: "UPSTREAM_TIMEOUT" });
  });
});

describe("transport edge cases", () => {
  it("keeps a response-body timeout classified as a timeout", async () => {
    const response = new Response("", { status: 200 });
    vi.spyOn(response, "json").mockRejectedValue(new DOMException("body timeout", "TimeoutError"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(resolvePlayer("body-timeout-fixture")).rejects.toMatchObject({ code: "UPSTREAM_TIMEOUT", status: 504 });
  });
  it("encodes special nickname characters exactly once", async () => {
    const nickname = "한글 +&?#%";
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ code: 200, user: { uid: "safe-fixture", nickname } }));
    vi.stubGlobal("fetch", fetcher);
    await resolvePlayer(nickname);
    const url = new URL(fetcher.mock.calls[0][0] as string);
    expect(url.searchParams.get("query")).toBe(nickname);
    expect([...url.searchParams.keys()]).toEqual(["query"]);
    expect(url.hash).toBe("");
  });
});
