import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createRequestGate, retryAfterSeconds } from "./request-gate";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-15T00:00:00Z")); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe("request limits", () => {
  it("preserves long seconds and HTTP dates without retrying early", () => {
    expect(retryAfterSeconds("9999")).toBe(9999);
    expect(retryAfterSeconds("Thu, 15 Oct 2026 02:00:00 GMT")).toBe(7200);
    expect(retryAfterSeconds("0")).toBe(0);
    expect(retryAfterSeconds("garbage")).toBe(60);
    expect(retryAfterSeconds(null)).toBe(60);
  });
  it("applies cooldown to waiting and future calls without executing them", async () => {
    const gate = createRequestGate({ spacingMs: 0 });
    const next = vi.fn(async () => 2);
    const first = gate.run(async () => { gate.block(9999); return 1; });
    const queued = gate.run(next).catch(error => error);
    expect(await first).toBe(1);
    expect(await queued).toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 9999 });
    await expect(gate.run(next)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(next).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(9999 * 1000);
    expect(await gate.run(next)).toBe(2);
  });
  it("aborts a stalled body and releases the queue", async () => {
    const gate = createRequestGate({ spacingMs: 0, requestMs: 80, totalMs: 200 });
    let signal: AbortSignal | undefined;
    const first = gate.run(async received => { signal = received; return new Promise(() => {}); }).catch(error => error);
    const second = gate.run(async () => "recovered");
    await vi.advanceTimersByTimeAsync(80);
    expect(await first).toMatchObject({ code: "UPSTREAM_TIMEOUT", status: 504 });
    expect(signal?.aborted).toBe(true);
    expect(await second).toBe("recovered");
  });
  it("bounds queued work and never executes a request after its deadline", async () => {
    const gate = createRequestGate({ spacingMs: 0, requestMs: 200, totalMs: 50, maxPending: 2 });
    const first = gate.run(() => new Promise(() => {})).catch(error => error);
    const work = vi.fn(async () => "late");
    const second = gate.run(work).catch(error => error);
    await expect(gate.run(work)).rejects.toMatchObject({ code: "REQUEST_QUEUE_FULL" });
    await vi.advanceTimersByTimeAsync(50);
    expect(await first).toMatchObject({ code: "UPSTREAM_TIMEOUT" });
    expect(await second).toMatchObject({ code: "UPSTREAM_TIMEOUT" });
    expect(work).not.toHaveBeenCalled();
    expect(await gate.run(async () => "ok")).toBe("ok");
  });
  it("spaces calls and converts body AbortError into timeout", async () => {
    const gate = createRequestGate({ spacingMs: 100, requestMs: 1000 });
    const first = gate.run(async () => 1);
    expect(await first).toBe(1);
    const work = vi.fn(async () => { throw new DOMException("aborted", "AbortError"); });
    const second = gate.run(work).catch(error => error);
    await vi.advanceTimersByTimeAsync(99);
    expect(work).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await second).toMatchObject({ code: "UPSTREAM_TIMEOUT", status: 504 });
  });
});

it("does not start work if the deadline expires between admission and dispatch", async () => {
  const start = Date.now();
  let reads = 0;
  vi.spyOn(Date, "now").mockImplementation(() => start + (++reads >= 8 ? 2 : 0));
  const gate = createRequestGate({ spacingMs: 0, totalMs: 1 });
  const work = vi.fn(async () => "too late");
  await expect(gate.run(work)).rejects.toMatchObject({ code: "UPSTREAM_TIMEOUT" });
  await Promise.resolve();
  expect(work).not.toHaveBeenCalled();
});
