import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ExpiringCache } from "./cache";
describe("bounded cache", () => {
  it("expires entries, enforces capacity and supports invalidation", () => {
    let now = 0;
    const cache = new ExpiringCache<number>(2, () => now);
    cache.set("a", 1, 10); cache.set("b", 2, 10); cache.set("c", 3, 10);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    cache.delete("b"); expect(cache.get("b")).toBeUndefined();
    now = 10; expect(cache.get("c")).toBeUndefined();
  });
});
