import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createMemoryRepository } from "./repository";
import { deduplicate } from "../domain";
import type { PlayerGame } from "../types";

const game: PlayerGame = { uid: "u1", gameId: "1", startedAt: "2026-10-01T00:00:00.000Z", characterCode: 7, matchingMode: 3, rank: null, kills: null, assists: 2, deaths: null, damage: null, duration: null, timestampPolicy: "assumed-Asia/Seoul" };
const player = { uid: "u1", nickname: "fixture" };
const info = { droppedRecords: 0, timestampPolicy: "explicit-offset" as const };
describe("duplicate observations and memory retention", () => {
  it("fills missing measurements without changing the first valid value or input", () => {
    const later = { ...game, rank: 1, kills: 5, assists: 9 };
    expect(deduplicate([game, later])).toEqual([{ ...game, rank: 1, kills: 5 }]);
    expect(game.rank).toBeNull();
    expect(deduplicate([game, { ...later, characterCode: 8 }])).toEqual([game]);
    expect(deduplicate([game, { ...later, matchingMode: 2 }])).toEqual([game]);
  });
  it("keeps row provenance after empty syncs and updates valid measurements safely", async () => {
    const repo = createMemoryRepository();
    await repo.upsert(player, [game], info);
    await repo.upsert(player, [{ ...game, rank: 1, kills: 5, timestampPolicy: "explicit-offset" }], info);
    await repo.upsert(player, [], info);
    expect(await repo.getGames("u1")).toEqual([{ ...game, rank: 1, kills: 5 }]);
    await repo.upsert(player, [{ ...game, characterCode: 99, rank: 7 }], info);
    expect((await repo.getGames("u1"))[0]).toMatchObject({ characterCode: 7, rank: 1 });
    const copy = await repo.getGames("u1"); copy[0].rank = 99;
    expect((await repo.getGames("u1"))[0].rank).toBe(1);
  });
  it("evicts all parts of expired users and caps players and games", async () => {
    let now = 1000;
    const repo = createMemoryRepository({ now: () => now, ttlMs: 100, maxPlayers: 1, maxGamesPerPlayer: 1 });
    await repo.upsert(player, [game, { ...game, gameId: "2", startedAt: "2026-10-02T00:00:00.000Z" }], info);
    expect((await repo.getGames("u1")).map(row => row.gameId)).toEqual(["2"]);
    await repo.upsert({ uid: "u2", nickname: "second" }, [], info);
    expect(await repo.findPlayer("fixture")).toBeNull();
    expect(await repo.getSync("u1")).toBeNull();
    now += 101;
    expect(await repo.findPlayer("second")).toBeNull();
    expect(await repo.getSync("u2")).toBeNull();
  });
  it("rejects cross-player records atomically and labels legacy provenance unknown", async () => {
    const repo = createMemoryRepository();
    await expect(repo.upsert(player, [{ ...game, uid: "other" }], info)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(await repo.getSync("u1")).toBeNull();
    await repo.upsert(player, [{ ...game, timestampPolicy: undefined }], info);
    expect((await repo.getGames("u1"))[0].timestampPolicy).toBe("unknown");
  });
});
