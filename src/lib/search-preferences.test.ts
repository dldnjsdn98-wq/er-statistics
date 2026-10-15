import { describe, expect, it } from "vitest";
import { activeQuickPeriod, conditionsKey, decodeConditions, normalizeConditions, quickPeriod, readConditions, rememberCondition, SAVED_KEY, shareUrl, writeConditions } from "./search-preferences";
import { parseQuery } from "./domain";
import type { Query } from "./types";

const base: Query = { nickname: "TopRain", startDate: "2026-10-01", endDate: "2026-10-15", mode: "ranked", characterCodes: [7, 1], page: 3, pageSize: 50 };
const condition = { nickname: base.nickname, startDate: base.startDate, endDate: base.endDate, mode: base.mode, characterCodes: base.characterCodes };

describe("local search conditions", () => {
  it("canonicalizes character order, preserves nickname case and ignores pagination", () => {
    expect(normalizeConditions(condition)?.characterCodes).toEqual([1, 7]);
    expect(conditionsKey(condition)).toBe(conditionsKey({ ...condition, characterCodes: [1, 7, 1] }));
    expect(conditionsKey(condition)).not.toBe(conditionsKey({ ...condition, nickname: "toprain" }));
    expect(rememberCondition([condition], { ...condition, characterCodes: [1, 7] })).toHaveLength(1);
    expect(rememberCondition(Array.from({ length: 5 }, (_, index) => ({ ...condition, nickname: String(index) })), condition)).toHaveLength(5);
  });
  it("rejects corrupt and untrusted stored data and caps/deduplicates entries", () => {
    expect(decodeConditions("no json")).toEqual([]);
    expect(decodeConditions(JSON.stringify({ nickname: "x" }))).toEqual([]);
    expect(normalizeConditions({ ...condition, mode: { value: "ranked" } })).toBeNull();
    expect(normalizeConditions({ ...condition, characterCodes: Array(101).fill(1) })).toBeNull();
    const raw = JSON.stringify([condition, { ...condition, characterCodes: [1, 7] }, { ...condition, nickname: "", characterCodes: [] }, { ...condition, startDate: "2026-02-30" }, ...Array.from({ length: 10 }, (_, i) => ({ ...condition, nickname: `player${i}` }))]);
    expect(decodeConditions(raw).map(item => item.nickname)).toEqual(["TopRain", "player0", "player1", "player2", "player3"]);
    const blocked = { getItem: () => { throw Error("blocked"); }, setItem: () => { throw Error("blocked"); } };
    expect(readConditions(blocked, SAVED_KEY)).toEqual([]);
    expect(writeConditions(blocked, SAVED_KEY, [condition])).toBe(false);
  });
  it("shares only the applied query, including its page and sorted character codes", () => {
    const url = new URL(shareUrl("https://example.test", "/insight", base));
    expect(url.pathname).toBe("/insight");
    expect(url.searchParams.get("characterCodes")).toBe("1,7");
    expect(parseQuery(url.searchParams)).toEqual({ ...base, characterCodes: [1, 7] });
    expect(url.toString()).not.toContain("draft-player");
  });
});

describe("quick KST periods", () => {
  it("includes today and crosses midnight, month and leap-day boundaries", () => {
    const beforeKstMidnight = Date.parse("2024-03-31T14:59:59.000Z");
    const afterKstMidnight = Date.parse("2024-03-31T15:00:00.000Z");
    expect(quickPeriod(7, beforeKstMidnight)).toEqual({ startDate: "2024-03-25", endDate: "2024-03-31" });
    expect(quickPeriod(7, afterKstMidnight)).toEqual({ startDate: "2024-03-26", endDate: "2024-04-01" });
    expect(quickPeriod(30, Date.parse("2024-03-01T03:00:00Z"))).toEqual({ startDate: "2024-02-01", endDate: "2024-03-01" });
    expect(quickPeriod(90, Date.parse("2024-03-01T03:00:00Z"))).toEqual({ startDate: "2023-12-03", endDate: "2024-03-01" });
    expect(activeQuickPeriod("2024-02-01", "2024-03-01", Date.parse("2024-03-01T03:00:00Z"))).toBe(30);
  });
});
