import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
vi.mock("server-only", () => ({}));
import { closeRepository, repository } from "./repository";
import type { PlayerGame } from "../types";

const testUrl = process.env.TEST_DATABASE_URL;
const schema = "er_test_" + randomUUID().replaceAll("-", "");
let admin: Pool;
const player = { uid: "pg-fixture", nickname: "fixture" };
const info = { droppedRecords: 0, timestampPolicy: "explicit-offset" as const };
const game: PlayerGame = { uid: player.uid, gameId: "1", startedAt: "2026-10-01T00:00:00.000Z", characterCode: 7, matchingMode: 3, rank: null, kills: 1, assists: null, deaths: 0, damage: null, duration: 900, timestampPolicy: "assumed-Asia/Seoul" };

describe.skipIf(!testUrl)("isolated PostgreSQL repository", () => {
  beforeAll(async () => {
    const url = new URL(testUrl!);
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/er_statistics_test") throw new Error("Only the dedicated local test database is allowed");
    admin = new Pool({ connectionString: url.toString(), max: 1 });
    await admin.query("CREATE SCHEMA " + schema);
    await admin.query("SET search_path TO " + schema);
    for (const migration of ["001_init.sql", "002_timestamp_policy.sql"]) {
      await admin.query(readFileSync(new URL("../../../db/" + migration, import.meta.url), "utf8"));
    }
    url.searchParams.set("options", "-c search_path=" + schema);
    vi.stubEnv("DATABASE_URL", url.toString());
  });
  afterAll(async () => {
    await closeRepository();
    if (admin) { await admin.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE"); await admin.end(); }
    vi.unstubAllEnvs();
  });
  it("retains provenance across empty syncs and keeps corrections without null overwrite", async () => {
    const repo = repository();
    await repo.upsert(player, [game], info);
    await repo.upsert(player, [{ ...game, rank: 1, kills: 5, timestampPolicy: "explicit-offset" }], info);
    await repo.upsert(player, [{ ...game, kills: null }], info);
    await repo.upsert(player, [], info);
    expect(await repo.getGames(player.uid)).toEqual([{ ...game, rank: 1, kills: 5 }]);
    expect(await repo.getSync(player.uid)).toMatchObject({ droppedRecords: 0 });
  });
  it("does not mix conflicting observations or retain a failed player insertion", async () => {
    const repo = repository();
    await repo.upsert(player, [{ ...game, characterCode: 99, rank: 99 }], info);
    expect((await repo.getGames(player.uid))[0]).toMatchObject({ characterCode: 7, rank: 1 });
    await expect(repo.upsert({ uid: "wrong", nickname: "wrong" }, [game], info)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(await repo.findPlayer("wrong")).toBeNull();
  });
  it("prunes old sync logs while retaining history and a successful sync", async () => {
    await admin.query("INSERT INTO sync_runs(uid,finished_at,status,timestamp_policy) VALUES($1,now()-interval '31 days','success','explicit-offset')", [player.uid]);
    await repository().upsert(player, [], info);
    const count = await admin.query("SELECT count(*)::int AS n FROM sync_runs WHERE uid=$1 AND finished_at < now()-interval '30 days'", [player.uid]);
    expect(count.rows[0].n).toBe(0);
    expect((await repository().getGames(player.uid)).length).toBe(1);
    expect((await repository().getSync(player.uid))?.lastSyncedAt).toBeTruthy();
  });
});
