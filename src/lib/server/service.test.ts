import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getStats } from "./service";
import { parseQuery } from "../domain";

beforeEach(() => { vi.stubEnv("ER_DATA_SOURCE", "demo"); vi.stubEnv("ER_API_KEY", ""); });

describe("provider selection", () => {
  const query = parseQuery(new URLSearchParams({ nickname: "임의의 닉네임", startDate: "2026-01-01", endDate: "2026-12-31", characterCodes: "1,2,8", mode: "normal" }));
  it("keeps demo identity explicit and selected zero-game rows", async () => {
    const result = await getStats(query);
    expect(result).toMatchObject({ source: "demo", storage: "fixture", player: { nickname: "데모플레이어" }, coverage: { completeness: "demo" } });
    expect(result.characters.map(row => row.code)).toContain(8);
    expect(result.characters.find(row => row.code === 8)).toMatchObject({ games: 0, winRate: null });
    expect(result.matches.every(match => [1, 2].includes(match.characterCode) && match.mode === "normal")).toBe(true);
  });
  it("never replaces an unconfigured live request with demo data", async () => {
    vi.stubEnv("ER_DATA_SOURCE", "live");
    await expect(getStats(query)).rejects.toMatchObject({ code: "LIVE_NOT_CONFIGURED", status: 503 });
  });
  it("accepts uppercase LIVE and whitespace while still choosing the live provider", async () => {
    vi.stubEnv("ER_DATA_SOURCE", "  LIVE  ");
    await expect(getStats(query)).rejects.toMatchObject({ code: "LIVE_NOT_CONFIGURED", status: 503 });
  });
  it("rejects unknown source values", async () => {
    vi.stubEnv("ER_DATA_SOURCE", "preview");
    await expect(getStats(query)).rejects.toMatchObject({ code: "LIVE_NOT_CONFIGURED", status: 503 });
  });
});
